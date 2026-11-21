export async function checkAvatarCrop(context) {
  const { assert, loadApp } = context;
  {
    const app = loadApp();
    const { createAccountAvatar } = app('lib/account-avatar.ts');
    const originalImage = globalThis.Image;
    const originalDocument = globalThis.document;
    let width = 64;
    let height = 64;
    const draws = [];
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage: (_image, ...coordinates) => draws.push(coordinates) }),
      toDataURL: () => 'data:image/png;base64,YXZhdGFy',
    };
    globalThis.Image = class {
      naturalWidth = width;
      naturalHeight = height;
      set src(_data) {
        queueMicrotask(() => this.onload());
      }
    };
    globalThis.document = { createElement: () => canvas };
    try {
      assert.equal(
        await createAccountAvatar('data:image/png;base64,c2tpbg=='),
        'data:image/png;base64,YXZhdGFy',
      );
      assert.equal(canvas.width, 8);
      assert.equal(canvas.height, 8);
      assert.deepEqual(
        draws,
        [
          [8, 8, 8, 8, 0, 0, 8, 8],
          [40, 8, 8, 8, 0, 0, 8, 8],
        ],
        'compose the face and head overlay instead of showing the entire skin sheet',
      );
      height = 32;
      assert.equal(
        await createAccountAvatar('data:image/png;base64,c2tpbg=='),
        'data:image/png;base64,YXZhdGFy',
      );
      width = 128;
      await assert.rejects(createAccountAvatar('data:image/png;base64,c2tpbg=='), /dimensions/);
      await assert.rejects(
        createAccountAvatar('https://textures.minecraft.net/texture/remote'),
        /cached skin/,
      );
      await assert.rejects(createAccountAvatar('data:text/html;base64,c2tpbg=='), /cached skin/);
    } finally {
      globalThis.Image = originalImage;
      globalThis.document = originalDocument;
    }
  }
}
