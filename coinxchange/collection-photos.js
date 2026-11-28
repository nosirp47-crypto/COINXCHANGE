// Private photos are fetched with the member's JWT. Only short-lived in-memory
// blob URLs reach the renderer; cloud photos never enter guest localStorage.
export const COIN_PHOTO_MAX_BYTES = 500 * 1024;
const BUCKET = 'coin-photos';
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const ownerPattern = new RegExp('^' + UUID + '$');
const pathPattern = new RegExp('^(' + UUID + ')/' + UUID + '\\.jpg$');

function ownsPath(path, owner) {
  return ownerPattern.test(owner) && typeof path === 'string' &&
    pathPattern.test(path) && path.slice(0, 36) === owner;
}

function jpegBlob(dataUrl) {
  if (typeof dataUrl !== 'string' || dataUrl.length > Math.ceil(COIN_PHOTO_MAX_BYTES / 3) * 4 + 24) {
    throw new Error('Choose a JPEG photo smaller than 500 KB.');
  }
  const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(dataUrl);
  if (!match || match[1].length % 4) throw new Error('The coin photo is not a valid JPEG.');
  let binary;
  try { binary = atob(match[1]); } catch { throw new Error('The coin photo is not a valid JPEG.'); }
  const bytes = Uint8Array.from(binary, value => value.charCodeAt(0));
  if (bytes.length < 5 || bytes.length > COIN_PHOTO_MAX_BYTES ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) {
    throw new Error('The coin photo is not a valid JPEG smaller than 500 KB.');
  }
  return new Blob([bytes], { type: 'image/jpeg' });
}

export function createPhotoStore(client) {
  const storage = client.storage.from(BUCKET);
  const objectUrls = new Set();
  let generation = 0;

  function clear() {
    generation += 1;
    for (const url of objectUrls) URL.revokeObjectURL(url);
    objectUrls.clear();
  }

  async function upload(owner, dataUrl) {
    if (!ownerPattern.test(owner)) throw new Error('Sign in before saving a photo.');
    const epoch = generation;
    const path = owner + '/' + crypto.randomUUID() + '.jpg';
    const photo = jpegBlob(dataUrl);
    const { data, error } = await storage.upload(path, photo, {
      contentType: 'image/jpeg', cacheControl: '0', upsert: false
    });
    if (error || !data || data.path !== path) throw new Error('The private photo could not be uploaded.');
    if (epoch !== generation) throw new Error('The account changed while saving the photo.');
    return path;
  }

  async function hydrate(items, owner) {
    clear();
    const epoch = generation;
    const result = items.map(item => ({ ...item, photoUrl: null, photoUnavailable: Boolean(item.photo_path) }));
    let index = 0;
    // Limit simultaneous requests when a member has a large collection.
    async function next() {
      while (index < result.length && epoch === generation) {
        const item = result[index++];
        if (!item.photo_path || item.owner_id !== owner || !ownsPath(item.photo_path, owner)) continue;
        try {
          const { data, error } = await storage.download(item.photo_path, {}, { cache: 'no-store' });
          if (error || !(data instanceof Blob) || data.type !== 'image/jpeg' ||
              !data.size || data.size > COIN_PHOTO_MAX_BYTES || epoch !== generation) continue;
          const url = URL.createObjectURL(data);
          objectUrls.add(url);
          item.photoUrl = url;
          item.photoUnavailable = false;
        } catch { /* Keep the coin details visible if its photo cannot load. */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(4, result.length) }, next));
    if (epoch !== generation) {
      return result.map(item => ({ ...item, photoUrl: null, photoUnavailable: Boolean(item.photo_path) }));
    }
    return result;
  }

  async function remove(path, owner) {
    if (!ownsPath(path, owner)) throw new Error('This photo does not belong to the current account.');
    const { data, error } = await storage.remove([path]);
    if (error || !Array.isArray(data) || !data.some(item => item.name === path)) {
      throw new Error('The private photo removal could not be confirmed.');
    }
  }

  return Object.freeze({ upload, hydrate, remove, clear });
}
