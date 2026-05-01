import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_ACCOUNTS_FILE = path.join(__dirname, 'accounts.json');

function normalizeUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function validateUsername(value) {
  return /^[a-z0-9]{3,24}$/.test(String(value || '').trim());
}

function validatePassword(value) {
  return typeof value === 'string' && value.length >= 6 && value.length <= 72;
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function generateSalt() {
  return randomBytes(16).toString('hex');
}

function generateToken() {
  return randomBytes(32).toString('hex');
}

function loadAccounts(filePath) {
  if (!fs.existsSync(filePath)) {
    return { users: [] };
  }
  try {
    const raw = fs.readFileSync(filePath, 'utf8');
    return raw ? JSON.parse(raw) : { users: [] };
  } catch {
    return { users: [] };
  }
}

function saveAccounts(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n', 'utf8');
}

export function createAccountStore(filePath = DEFAULT_ACCOUNTS_FILE) {
  const accountsFile = filePath;
  const store = loadAccounts(accountsFile);

  function findUser(username) {
    const normalized = normalizeUsername(username);
    return store.users.find((user) => user.username === normalized) || null;
  }

  function getUserByToken(token) {
    if (!token) return null;
    return store.users.find((user) => user.token === token) || null;
  }

  function persist() {
    saveAccounts(accountsFile, store);
  }

  function prepareUserRecord(username, password, nickname) {
    const normalized = normalizeUsername(username);
    const safeNick = String(nickname || username || '').trim().slice(0, 24) || normalized;
    const salt = generateSalt();
    const passwordHash = hashPassword(password, salt);
    const token = generateToken();
    return {
      username: normalized,
      nickname: safeNick,
      salt,
      passwordHash,
      token,
    };
  }

  return {
    validateCredentials(username, password) {
      if (!validateUsername(username)) {
        return { ok: false, error: '아이디는 영문 소문자 또는 숫자 3~24자이어야 합니다.' };
      }
      if (!validatePassword(password)) {
        return { ok: false, error: '비밀번호는 6자 이상 72자 이하이어야 합니다.' };
      }
      return { ok: true };
    },

    registerUser(username, password, nickname) {
      const normalized = normalizeUsername(username);
      const validation = this.validateCredentials(username, password);
      if (!validation.ok) return validation;
      if (findUser(normalized)) {
        return { ok: false, error: '이미 존재하는 아이디입니다.' };
      }
      const record = prepareUserRecord(username, password, nickname);
      store.users.push(record);
      persist();
      return {
        ok: true,
        token: record.token,
        user: { username: record.username, nickname: record.nickname },
      };
    },

    loginUser(username, password) {
      const validation = this.validateCredentials(username, password);
      if (!validation.ok) return validation;
      const user = findUser(username);
      if (!user) {
        return { ok: false, error: '아이디 또는 비밀번호가 일치하지 않습니다.' };
      }
      const hash = hashPassword(password, user.salt);
      const passwordMatch =
        hash.length === user.passwordHash.length &&
        timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(user.passwordHash, 'hex'));
      if (!passwordMatch) {
        return { ok: false, error: '아이디 또는 비밀번호가 일치하지 않습니다.' };
      }
      user.token = generateToken();
      persist();
      return {
        ok: true,
        token: user.token,
        user: { username: user.username, nickname: user.nickname },
      };
    },

    getUserByToken,

    updateNickname(username, nickname) {
      const user = findUser(username);
      if (!user) return null;
      user.nickname = String(nickname || '').trim().slice(0, 24) || user.nickname;
      persist();
      return { username: user.username, nickname: user.nickname };
    },
  };
}
