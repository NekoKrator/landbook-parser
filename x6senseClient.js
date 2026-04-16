const fs = require('fs/promises');
const path = require('path');

const API_BASE_URL = process.env.X6SENSE_API_BASE_URL;
const API_KEY = process.env.X6SENSE_API_KEY;

async function readFileAsBlob(filePath) {
  const buffer = await fs.readFile(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type =
    ext === '.webp'
      ? 'image/webp'
      : ext === '.jpg' || ext === '.jpeg'
        ? 'image/jpeg'
        : 'image/png';

  return new Blob([buffer], { type });
}

async function uploadFile(filePath) {
  if (!API_KEY) {
    throw new Error('X6SENSE_API_KEY is not set');
  }

  const blob = await readFileAsBlob(filePath);
  const fileName = path.basename(filePath);
  const form = new FormData();
  form.append('file', blob, fileName);

  const response = await fetch(`${API_BASE_URL}/api/file/upload`, {
    method: 'POST',
    headers: {
      'x-api-key': API_KEY,
    },
    body: form,
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Upload failed (${response.status}): ${text}`);
  }

  return JSON.parse(text);
}

async function sendModerationContent(payload) {
  if (!API_KEY) {
    throw new Error('X6SENSE_API_KEY is not set');
  }

  const response = await fetch(`${API_BASE_URL}/api/moderation/content`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': API_KEY,
    },
    body: JSON.stringify(payload),
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`Content send failed (${response.status}): ${text}`);
  }

  return text ? JSON.parse(text) : null;
}

module.exports = {
  uploadFile,
  sendModerationContent,
};
