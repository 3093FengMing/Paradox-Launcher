import type { useTranslation } from 'react-i18next';
type TFunction = ReturnType<typeof useTranslation>['t'];
const runtimeMessages = new Map<string, string>([
  ['等待下载', 'runtime.waitingDownload'],
  ['排队任务已取消', 'runtime.queuedCancelled'],
  ['正在停止下载并清理临时文件', 'runtime.cancellingDownload'],
  ['正在解析游戏文件与下载计划', 'runtime.resolvingGameFiles'],
  ['正在查询 Java 下载信息', 'runtime.resolvingJava'],
  ['下载已取消，临时文件已清理', 'runtime.downloadCancelled'],
  ['文件已下载，正在完成安装', 'runtime.finishingInstall'],
  ['正在校验已有文件', 'runtime.verifyingFiles'],
  ['正在准备下载', 'runtime.preparingDownload'],
  ['实例安装 / 修复完成', 'runtime.installComplete'],
  ['实例安装完成', 'runtime.installComplete'],
  ['Java 下载已取消', 'runtime.javaCancelled'],
  ['正在检查 Java 并构建启动命令', 'runtime.preparingLaunch'],
  ['正在检查 Java 并启动游戏', 'runtime.preparingLaunch'],
  ['启动已取消', 'runtime.launchCancelled'],
  ['正在停止启动或游戏进程', 'runtime.cancellingLaunch'],
  ['停止游戏失败，请重试', 'runtime.stopGameFailed'],
  ['已停止游戏进程', 'runtime.gameStopped'],
  ['游戏已停止', 'runtime.gameStopped'],
  ['没有运行中的游戏', 'runtime.noRunningGame'],
  ['游戏进程已经退出', 'runtime.gameAlreadyExited'],
  ['已有安装或游戏进程正在运行', 'runtime.busy'],
  ['游戏或其他任务正在运行，请结束后再下载', 'runtime.downloadWhileBusy'],
  ['请在安装或游戏结束后保存设置', 'runtime.saveWhileBusy'],
  ['请在当前任务结束后创建实例', 'runtime.createWhileBusy'],
  ['下载队列已满，请等待或取消已有任务', 'runtime.queueFull'],
  ['只有失败或已取消的任务可以重试', 'runtime.retryTerminalOnly'],
  ['下载任务已经结束', 'runtime.taskAlreadyFinished'],
  ['下载任务不存在', 'runtime.taskMissing'],
  ['实例不存在', 'api.profileMissing'],
  ['任务尚未安全结束，窗口已保留。请稍后重试关闭。', 'runtime.closePending'],
]);

/** Translate known launcher statuses while retaining unrecognized diagnostics. */
export function translateRuntimeMessage(message: string, t: TFunction): string {
  const code = /(?:auth|content|loaders)\.errors\.[A-Za-z]+/.exec(message)?.[0];
  if (code) return t(code);
  const translate = (key: string, variables: Record<string, string> = {}) => t(key, variables);
  const key = runtimeMessages.get(message);
  if (key) return translate(key);
  if (message.startsWith('正在下载：'))
    return translate('runtime.downloadingFile', { file: message.slice('正在下载：'.length) });
  if (message.startsWith('游戏进程已退出：'))
    return translate('runtime.gameExited', { status: message.slice('游戏进程已退出：'.length) });
  const java = /^Java (\d+) 已安装：(.+)$/s.exec(message);
  if (java) return translate('runtime.javaInstalled', { version: java[1], path: java[2] });
  const started = /^(.+) 已启动$/s.exec(message);
  if (started) return translate('runtime.gameStarted', { name: started[1] });
  const installing = /^正在安装 \/ 修复 (.+) · (.+)$/s.exec(message);
  if (installing)
    return translate('runtime.installingInstance', { name: installing[1], version: installing[2] });
  return message;
}
