import { useCallback, useState } from 'preact/hooks';
import { CivSelect } from './screens/CivSelect';
import { GameScreen, type GameHooks } from './screens/GameScreen';
import { Loading } from './screens/Loading';
import { MainMenu } from './screens/MainMenu';
import type { Screen } from './screens/types';
import type { AppHost } from './host';

/** Screen router: menu / civ select / loading / game. */
export function App({ host, hooks }: { host: AppHost; hooks?: GameHooks }) {
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
      return <MainMenu navigate={navigate} host={host} />;
    case 'civSelect':
      return <CivSelect navigate={navigate} host={host} />;
    case 'loading':
      return <Loading source={screen.source} navigate={navigate} host={host} />;
    case 'game':
      return <GameScreen sim={screen.sim} config={screen.config} host={host} navigate={navigate} hooks={hooks} />;
  }
}
