import { Icon, type IconName } from '../components/Icon';
import { Topbar } from '../components/Topbar';

export interface PlaceholderProps {
  title: string;
  icon: IconName;
  stage: number;
  blurb: string;
  items: string[];
}

/** Sections that arrive in later stages. */
export function Placeholder({ title, icon, stage, blurb, items }: PlaceholderProps) {
  return (
    <>
      <Topbar title={title} />
      <main>
        <div class="card empty">
          <span class="secondary">
            <Icon name={icon} size={36} />
          </span>
          <h2>{title} arrives in stage {stage}</h2>
          <p>{blurb}</p>
          <ul>
            {items.map((i) => (
              <li key={i}>{i}</li>
            ))}
          </ul>
        </div>
      </main>
    </>
  );
}
