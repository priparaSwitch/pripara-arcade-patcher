// ASCII key/value edits preserve every unrelated original byte and line ending.
const ascii = value => { if (!/^[\x20-\x7e]*$/.test(value) || /[\r\n]/.test(value)) throw new Error('설정 경로와 값에는 영문·숫자를 사용해 주세요.'); return value; };
function cameraOptions(options) {
  return { vid: 'CAFE', pid: '0002' };
}
function valueWithLayout(old, value) {
  const match = old.match(/^([ \t]*)(.*?)([ \t]*(?:[;#].*)?)$/);
  return match[1] + value + match[3];
}
export function patchConfigBytes(bytes, path, options = {}) {
  const input = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (input.length > 1024 * 1024 || input[0] === 0xFF || input[0] === 0xFE) throw new Error('지원하지 않는 설정 파일 형식입니다.');
  const bom = input.length >= 3 && input[0] === 0xEF && input[1] === 0xBB && input[2] === 0xBF;
  let text = ''; for (const b of input.subarray(bom ? 3 : 0)) text += String.fromCharCode(b);
  const relative = path.replaceAll('\\', '/').replace(/^\.\//, '').toLowerCase();
  const cam = cameraOptions(options), seen = new Map();
  let section = '', updates;
  if (relative === 'system_options.txt') {
    let install = ascii(options.installPath || 'C:\\prineohk\\game').replaceAll('/', '\\').replace(/\\+$/, '');
    if (!/^[A-Za-z]:\\/.test(install) || install.includes(',')) throw new Error('설치할 게임 폴더의 전체 경로를 입력해 주세요.');
    const state = ascii(options.statePath || install.substring(0, 3));
    const window = options.windowInfo === undefined ? '1,720,1280' : ascii(options.windowInfo);
    if (!/^[01],\d{2,5},\d{2,5}$/.test(window)) throw new Error('창 설정이 올바르지 않습니다.');
    updates = { current_path: install, gamedata_current_path: state, setting_path: install + '\\setting', smartsignage_path: state, window_info: window, camera_pid1: '0x' + cam.pid, camera_pid2: '0x' + cam.pid, camera_vid1: '0x' + cam.vid, camera_vid2: '0x' + cam.vid };
  } else if (relative !== 'camera/qrreader.ini') throw new Error('지원하지 않는 설정 파일입니다.');
  const lines = text.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g).filter(Boolean);
  const output = lines.map(line => {
    const ending = line.match(/(?:\r\n|\n|\r)$/)?.[0] || '', body = line.slice(0, line.length - ending.length);
    if (!updates) {
      const heading = body.match(/^\s*\[([^\]]+)\]\s*(?:[;#].*)?$/);
      if (heading) section = heading[1].toLowerCase();
      const m = body.match(/^([ \t]*)([A-Za-z0-9_]+)([ \t]*=[ \t]*)(.*)$/);
      if (m && ['camera0', 'camera1'].includes(section) && /^(?:vid|pid)[0-3]$/i.test(m[2])) {
        const key = section + '/' + m[2].toLowerCase(); seen.set(key, (seen.get(key) || 0) + 1);
        return m[1] + m[2] + m[3] + valueWithLayout(m[4], /^vid/i.test(m[2]) ? cam.vid : cam.pid) + ending;
      }
    } else {
      const m = body.match(/^([ \t]*)([A-Za-z0-9_]+)([ \t]*,)(.*)$/), key = m?.[2].toLowerCase();
      if (m && Object.hasOwn(updates, key)) {
        seen.set(key, (seen.get(key) || 0) + 1);
        return m[1] + m[2] + m[3] + valueWithLayout(m[4], updates[key]) + ending;
      }
    }
    return line;
  }).join('');
  const wanted = updates ? Object.keys(updates) : ['camera0', 'camera1'].flatMap(s => ['vid', 'pid'].flatMap(k => [0, 1, 2, 3].map(n => s + '/' + k + n)));
  if (wanted.some(k => seen.get(k) !== 1)) throw new Error('필수 설정 항목이 없거나 중복되어 있습니다.');
  const prefix = bom ? [0xEF, 0xBB, 0xBF] : [], result = new Uint8Array(prefix.length + output.length); result.set(prefix);
  for (let i = 0; i < output.length; i++) result[prefix.length + i] = output.charCodeAt(i);
  return result;
}
