import * as api from '../api';
import i18n from '../i18n';
import { canStopLaunch } from '../lib/activity';
import type { Activity, GameProfile } from '../types';
interface Cell<T> {
  current: T;
}
interface GameDependencies {
  busyRef: Cell<Activity | null>;
  stopPending: Cell<boolean>;
  actionSequence: Cell<number>;
  lifecycle: Cell<number>;
  launchProfileKey: Cell<string | null>;
  setBusy: (value: Activity | null) => void;
  notify: (message: string, error?: boolean) => void;
  reportError: (error: unknown) => void;
}
/** Backend terminal events own busy state after game registration. */
export function createGameActions(host: GameDependencies) {
  const { busyRef, stopPending, actionSequence, lifecycle, launchProfileKey, setBusy, notify, reportError } = host;
  const runAction = async (action: 'install' | 'launch', profile: GameProfile) => {
    if (action === 'install') {
      try {
        await api.enqueueInstall(profile.instance_key);
        notify(i18n.t('messages.profileQueued', { name: profile.name }));
      } catch (error) {
        reportError(error);
      }
      return;
    }
    if (busyRef.current || stopPending.current) return;
    const request = ++actionSequence.current;
    const generation = lifecycle.current;
    const activity: Activity = {
      action,
      status: 'started',
      message: i18n.t('messages.checkingJava'),
    };
    busyRef.current = activity;
    launchProfileKey.current = profile.instance_key;
    setBusy(activity);
    try {
      await api.launchInstance(profile.instance_key);
    } catch (error) {
      if (request !== actionSequence.current || generation !== lifecycle.current) return;
      // A rejected command can release its optimistic state before registration.
      // Once activity events arrive, only a backend terminal event releases busy.
      if (busyRef.current === activity) {
        busyRef.current = null;
        launchProfileKey.current = null;
        setBusy(null);
      }
      reportError(error);
    }
  };

  const stopGame = async () => {
    if (stopPending.current || !canStopLaunch(busyRef.current)) return;
    stopPending.current = true;
    const generation = lifecycle.current;
    try {
      await api.stopGame();
    } catch (error) {
      if (generation === lifecycle.current) reportError(error);
    } finally {
      stopPending.current = false;
    }
  };

  return { runAction, stopGame };
}
