import type { Activity } from '../types';

export function isLaunchActive(activity: Activity | null | undefined): boolean {
  return (
    activity?.action === 'launch' &&
    (activity.status === 'started' ||
      activity.status === 'running' ||
      activity.status === 'cancelling')
  );
}

export function isCancelling(activity: Activity | null | undefined): boolean {
  return activity?.status === 'cancelling';
}

export function canStopLaunch(activity: Activity | null | undefined): boolean {
  return isLaunchActive(activity) && !isCancelling(activity);
}
