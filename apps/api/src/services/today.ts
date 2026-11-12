/**
 * TodayService: load history from D1 → run the engine → persist the
 * assessment and recommendation → shape the Today DTO.
 *
 * The engine runs on every request (it takes milliseconds). Its inputs hash
 * decides whether anything is written: unchanged inputs keep the current
 * recommendation, including any modification the user made; changed inputs
 * (e.g. last night's sleep arrived) produce a fresh engine recommendation.
 */
import {
  addDays,
  applyModification,
  assessDay,
  ENGINE_LOOKBACK_DAYS,
  localDate,
  type DailyAssessment,
  type IsoDate,
  type ModificationRequest,
} from '@coach/engine';
import type { LoadStatus, TodayResponse } from '@coach/shared';
import type { Repositories } from '../db';
import type { StoredRecommendation } from '../db/recommendations';
import type { Env } from '../env';
import { seedMockData } from '../garmin';

export class TodayService {
  constructor(
    private readonly repos: Repositories,
    private readonly env: Env,
    private readonly now: () => Date = () => new Date(),
  ) {}

  private timestamp(): string {
    return this.now().toISOString().replace(/\.\d{3}Z$/, 'Z');
  }

  private async load() {
    let settings = await this.repos.settings.get();
    const date = localDate(this.now(), settings.timezone);
    const from = addDays(date, -ENGINE_LOOKBACK_DAYS);
    let metrics = await this.repos.health.getDailyMetrics(from, date);
    if (metrics.length === 0 && this.env.GARMIN_MODE === 'mock') {
      // First run in mock mode: seed a realistic history so Today works immediately.
      // Seeding may fill in the demo athlete's profile, so settings are read again.
      await seedMockData(this.repos, this.env, date, this.now);
      settings = await this.repos.settings.get();
      metrics = await this.repos.health.getDailyMetrics(from, date);
    }
    const activities = await this.repos.activities.listBetween(from, date);
    const assessment = assessDay({ date, metrics, activities, settings });

    let current = await this.repos.recommendations.getCurrent(date);
    if (!current || current.inputsHash !== assessment.inputsHash) {
      const now = this.timestamp();
      await this.repos.assessments.upsert(assessment, now);
      current = await this.repos.recommendations.insertEngine(date, assessment.recommendation, {
        engineVersion: assessment.engineVersion,
        inputsHash: assessment.inputsHash,
        now,
      });
    }
    return { settings, date, metrics, assessment, current };
  }

  async get(): Promise<TodayResponse> {
    const { date, metrics, assessment, current } = await this.load();
    return this.toResponse(date, metrics.find((m) => m.date === date) ?? null, assessment, current);
  }

  async modify(request: ModificationRequest): Promise<TodayResponse> {
    const { settings, date, metrics, assessment, current } = await this.load();
    const result = applyModification(assessment, current.workout, request, settings);
    let rec = current;
    if (result.applied) {
      rec = await this.repos.recommendations.insertModification(
        current,
        {
          kind: request.kind,
          minutes: request.kind === 'time_limit' ? (request.minutes ?? null) : null,
          workout: result.workout,
          reasons: result.reasons,
        },
        this.timestamp(),
      );
    }
    const body = await this.toResponse(date, metrics.find((m) => m.date === date) ?? null, assessment, rec);
    return { ...body, modificationResult: { applied: result.applied, reasons: result.reasons } };
  }

  /** Drops all modifications: the engine's original recommendation becomes current again. */
  async reset(): Promise<TodayResponse> {
    const { date, metrics, assessment, current } = await this.load();
    const [root] = await this.repos.recommendations.lineage(current.id);
    let rec = current;
    if (root && root.id !== current.id) {
      await this.repos.recommendations.makeCurrent(root);
      rec = root;
    }
    return this.toResponse(date, metrics.find((m) => m.date === date) ?? null, assessment, rec);
  }

  private async toResponse(
    date: IsoDate,
    today: TodayResponse['today'],
    a: DailyAssessment,
    current: StoredRecommendation,
  ): Promise<TodayResponse> {
    const chain = await this.repos.recommendations.lineage(current.id);
    const root = chain[0] ?? current;
    const mods = chain.filter((r) => r.origin === 'modification');
    const [lastRun] = await this.repos.sync.recentRuns(1);
    const acwr = a.load.acwr;
    const status: LoadStatus =
      acwr === null ? 'unknown' : acwr > 1.5 ? 'spike' : acwr > 1.3 ? 'high' : acwr < 0.8 ? 'low' : 'balanced';

    return {
      date,
      generatedAt: this.timestamp(),
      engineVersion: a.engineVersion,
      garminMode: this.env.GARMIN_MODE === 'live' ? 'live' : 'mock',
      lastSyncAt: lastRun?.finishedAt ?? null,
      today,
      readiness: a.readiness,
      flags: a.flags,
      load: { atl: a.load.atl, ctl: a.load.ctl, tsb: a.load.tsb, acwr, status, sufficientHistory: a.load.sufficientHistory },
      yesterday: a.load.yesterday,
      week: {
        last7: a.load.last7,
        previous7: a.load.previous7,
        avgWeek28: a.load.avgWeek28,
        intensity28: a.load.intensityDistribution28,
        hardDaysLast7: a.load.hardDaysLast7,
      },
      recommendation: {
        id: current.id,
        ruleId: root.ruleId,
        workout: current.workout,
        reasons: root.reasons,
        summary: a.recommendation.summary,
        harder: a.recommendation.harder,
        modifications: mods.map((m) => ({ kind: m.modificationKind!, minutes: m.modificationMinutes, reasons: m.reasons })),
        original: mods.length
          ? { type: root.workout.type, title: root.workout.title, durationSec: root.workout.durationSec }
          : null,
      },
    };
  }
}
