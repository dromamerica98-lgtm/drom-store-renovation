import { Icon, type IconName } from './components/Icon';
import { Link, useRoute, type Route } from './router';
import { Placeholder, type PlaceholderProps } from './screens/Placeholder';
import { TodayScreen } from './screens/today/TodayScreen';

const NAV: Array<{ to: Route; label: string; icon: IconName; inTabbar: boolean }> = [
  { to: '/', label: 'Today', icon: 'today', inTabbar: true },
  { to: '/health', label: 'Health', icon: 'health', inTabbar: true },
  { to: '/training', label: 'Training', icon: 'training', inTabbar: true },
  { to: '/coach', label: 'Coach', icon: 'coach', inTabbar: true },
  { to: '/trends', label: 'Trends', icon: 'trends', inTabbar: true },
  { to: '/settings', label: 'Settings', icon: 'settings', inTabbar: false },
];

const PLACEHOLDERS: Record<Exclude<Route, '/'>, PlaceholderProps> = {
  '/health': {
    title: 'Health',
    icon: 'health',
    stage: 7,
    blurb: 'Your recovery signals and how they move against your own baseline.',
    items: ['Sleep stages and sleep score', 'HRV with your normal range', 'Body Battery and stress through the day', 'Resting heart rate trend'],
  },
  '/training': {
    title: 'Training',
    icon: 'training',
    stage: 8,
    blurb: 'What you did, how hard, and how it adds up.',
    items: ['Weekly and monthly volume', 'Intensity distribution', 'Activity history and details (laps, HR, pace)'],
  },
  '/coach': {
    title: 'Coach',
    icon: 'coach',
    stage: 11,
    blurb: "Ask about today's plan. The coach explains the engine's reasoning and can apply the same guarded adjustments you have on Today.",
    items: ['Natural-language explanation of the recommendation', 'Suggested modifications', 'Questions and answers'],
  },
  '/trends': {
    title: 'Trends',
    icon: 'trends',
    stage: 9,
    blurb: 'Long-term changes in recovery, fitness and training load.',
    items: ['Readiness and HRV over months', 'Fitness (chronic load) and fatigue', 'Training volume over time'],
  },
  '/settings': {
    title: 'Settings',
    icon: 'settings',
    stage: 10,
    blurb: 'Tell the engine about your goals and physiology.',
    items: ['Training goal and available days', 'Preferred and maximum duration', 'Heart-rate and pace zones', 'Garmin connection'],
  },
};

export function App() {
  const route = useRoute();
  return (
    <div class="app">
      <nav class="rail" aria-label="Sections">
        <div class="brand">
          <img src="/icons/icon-192.png" alt="" />
          Coach
        </div>
        {NAV.filter((n) => n.to !== '/settings').map((n) => (
          <Link key={n.to} to={n.to}>
            <Icon name={n.icon} />
            {n.label}
          </Link>
        ))}
        <span class="spacer" />
        <Link to="/settings">
          <Icon name="settings" />
          Settings
        </Link>
      </nav>
      <div>{route === '/' ? <TodayScreen /> : <Placeholder {...PLACEHOLDERS[route]} />}</div>
      <nav class="tabbar" aria-label="Sections">
        {NAV.filter((n) => n.inTabbar).map((n) => (
          <Link key={n.to} to={n.to} class="tab">
            <Icon name={n.icon} size={24} />
            {n.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
