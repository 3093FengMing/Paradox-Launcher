import type { CSSProperties } from 'react';
import { Dialog } from '@base-ui/react/dialog';
import { Box, LayoutGrid, LoaderCircle, Plus, X } from 'lucide-react';
import { Badge, Field } from './ui';
import type { ProfileEditor } from '../lib/forms';

interface ProfileDialogProps {
  editor: ProfileEditor | null;
  saving: boolean;
  theme: 'light' | 'dark';
  variables: CSSProperties;
  reduceMotion: boolean;
  keyboardNavigation: boolean;
  onChange: (patch: Partial<ProfileEditor>) => void;
  onClose: () => void;
  onSave: () => void;
}

export default function ProfileDialog({
  editor,
  saving,
  theme,
  variables,
  reduceMotion,
  keyboardNavigation,
  onChange,
  onClose,
  onSave,
}: ProfileDialogProps) {
  return (
    <Dialog.Root
      open={editor !== null}
      onOpenChange={(open) => {
        if (!open && !saving) onClose();
      }}
    >
      <Dialog.Portal>
        <div
          className={`dialog-theme ${reduceMotion ? 'reduce-motion' : ''} ${keyboardNavigation ? 'keyboard-navigation' : ''}`}
          data-theme={theme}
          style={variables}
        >
          <Dialog.Backdrop className="modal-backdrop" />
          <Dialog.Popup
            className="modal"
            initialFocus={() => document.getElementById('profile-name')}
          >
            {editor && (
              <>
                <div className="modal-heading">
                  <div className="metric-icon">
                    <Box size={23} />
                  </div>
                  <button
                    className="icon-button"
                    aria-label="关闭对话框"
                    disabled={saving}
                    onClick={onClose}
                  >
                    <X size={19} />
                  </button>
                </div>
                <Dialog.Title className="modal-title">
                  {editor.editKey ? '重命名实例' : '创建游戏实例'}
                </Dialog.Title>
                <Dialog.Description className="modal-description">
                  {editor.editKey
                    ? '修改显示名称，实例文件位置保持不变。'
                    : '为不同版本与存档创建独立空间。'}
                </Dialog.Description>
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    onSave();
                  }}
                >
                  <Field label="实例名称">
                    <input
                      id="profile-name"
                      required
                      disabled={saving}
                      placeholder="例如：我的生存世界"
                      maxLength={64}
                      value={editor.name}
                      onChange={(event) => onChange({ name: event.target.value })}
                    />
                  </Field>
                  <Field label="Minecraft 版本">
                    <input
                      required
                      disabled={saving || !!editor.editKey}
                      value={editor.version}
                      onChange={(event) => onChange({ version: event.target.value })}
                    />
                  </Field>
                  <div className="modal-type">
                    <LayoutGrid size={17} />
                    <span>Vanilla 原版</span>
                    <Badge>已支持</Badge>
                  </div>
                  <div className="modal-buttons">
                    <button type="button" className="secondary" disabled={saving} onClick={onClose}>
                      取消
                    </button>
                    <button type="submit" className="primary" disabled={saving}>
                      {saving ? <LoaderCircle className="spin" size={16} /> : <Plus size={16} />}
                      {editor.editKey ? '保存名称' : '创建实例'}
                    </button>
                  </div>
                </form>
              </>
            )}
          </Dialog.Popup>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
