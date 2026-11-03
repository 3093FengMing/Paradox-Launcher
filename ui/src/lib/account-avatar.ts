export function createAccountAvatar(data: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(data)) {
      reject(new Error('Invalid cached skin'));
      return;
    }
    const image = new Image();
    image.onerror = () => reject(new Error('Invalid cached skin'));
    image.onload = () => {
      if (image.naturalWidth !== 64 || ![32, 64].includes(image.naturalHeight)) {
        reject(new Error('Invalid skin dimensions'));
        return;
      }
      try {
        const canvas = document.createElement('canvas');
        canvas.width = 8;
        canvas.height = 8;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Avatar rendering is unavailable');
        context.imageSmoothingEnabled = false;
        context.drawImage(image, 8, 8, 8, 8, 0, 0, 8, 8);
        context.drawImage(image, 40, 8, 8, 8, 0, 0, 8, 8);
        resolve(canvas.toDataURL('image/png'));
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Avatar rendering is unavailable'));
      }
    };
    image.src = data;
  });
}
