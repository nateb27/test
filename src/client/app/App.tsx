import { useCallback, useState } from 'preact/hooks';
import { CivSelect } from './screens/CivSelect';
import { GameScreen } from './screens/GameScreen';
import { Loading } from './screens/Loading';
import { MainMenu } from './screens/MainMenu';
import type { Screen } from './screens/types';
import type { AppHost } from './host';

/** Screen router: menu / civ select / loading / game. */
export function App({ host }: { host: AppHost }) {
  const [screen, setScreen] = useState<Screen>({ name: 'menu' });
  const navigate = useCallback(
    (next: Screen) => {
      host.screen = next.name;
      setScreen(next);
    },
    [host],
  );

  switch (screen.name) {
    case 'menu':
      return <MainMenu navigate={navigate} />;
    case 'civSelect':
      return <CivSelect navigate={navigate} />;
    case 'loading':
      return <Loading config={screen.config} navigate={navigate} />;
    case 'game':
      return <GameScreen sim={screen.sim} host={host} />;
  }
}
