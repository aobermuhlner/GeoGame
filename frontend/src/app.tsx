import { useEffect, useRef, useState } from 'preact/hooks';
import { REGION_IDS } from '@flagduel/shared';
import type { GameActions, GameVM } from './types';
import { Home } from './components/Home';
import { GameScreen } from './components/GameScreen';
import { Results } from './components/Results';

const NAME_KEY = 'flagduel.name';

function readName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* storage unavailable — ignore */
  }
}

export function App() {
  const [vm, setVm] = useState<GameVM | null>(null);
  const actionsRef = useRef<(GameActions & { dispose(): void }) | null>(null);
  const roomParam = new URLSearchParams(location.search).get('room') ?? '';

  useEffect(() => () => actionsRef.current?.dispose(), []);

  async function startDemo(name: string) {
    saveName(name);
    if (!import.meta.env.DEV) return;
    const { startMockGame } = await import('./mock');
    actionsRef.current?.dispose();
    const game = startMockGame({
      name,
      botName: 'Anna',
      regions: [...REGION_IDS],
      bot: new URLSearchParams(location.search).get('bot') === 'lazy' ? 'lazy' : 'normal',
      onUpdate: setVm,
    });
    actionsRef.current = {
      ...game,
      leave() {
        game.dispose();
        setVm(null);
      },
    };
  }

  const actions = actionsRef.current;
  if (vm && actions) {
    return vm.phase === 'finished' ? <Results vm={vm} actions={actions} /> : <GameScreen vm={vm} actions={actions} />;
  }
  return <Home initialName={readName()} initialCode={roomParam.toUpperCase().slice(0, 5)} onDemo={startDemo} />;
}
