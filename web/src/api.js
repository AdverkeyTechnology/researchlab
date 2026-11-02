import { upload as uploadBlob } from '@vercel/blob/client';
// Thin client for the session JSON API. Every write carries the custom header the
// server requires (blocks cross-site form posts).
const HEADER = { 'X-Requested-With': 'research-hub' };

let tokenGetter;
export function setTokenGetter(getter) { tokenGetter = getter; }
async function authHeaders() {
  const token = await tokenGetter?.();
  return { ...HEADER, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
}

export class ApiError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

async function request(method, url, body) {
  const opts = { method, headers: await authHeaders(), credentials: 'same-origin' };
  if (body instanceof FormData) opts.body = body;
  else if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers['Content-Type'] = 'application/json'; }
  const res = await fetch(url, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || `Request failed (${res.status})`);
  return data;
}

export const api = {
  get: (u) => request('GET', u),
  post: (u, b = {}) => request('POST', u, b),
  patch: (u, b) => request('PATCH', u, b),
  put: (u, b) => request('PUT', u, b),
  del: (u) => request('DELETE', u),
  // Multipart upload with progress (fetch can't report upload progress).
  async upload(url, formData, onProgress) {
    const file=formData.get('file');
    if(file instanceof File) {
      if(file.size>100*1024*1024) throw new ApiError(413,'Maximum file size is 100 MB.');
      const init=await request('POST',url.replace(/\/reports$/, '/uploads'),{filename:file.name});
      if(init.direct) {
        await uploadBlob(init.pathname,file,{access:'private',handleUploadUrl:'/api/app/blob/upload',headers:await authHeaders(),multipart:true,onUploadProgress:ev=>onProgress?.(ev.percentage/100)});
        const fields=Object.fromEntries(formData.entries()); delete fields.file;
        fields.allowed=formData.getAll('allowed'); fields.uploadId=init.id;
        return request('POST',url,fields);
      }
    }

    const headers = await authHeaders();
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url);
      for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
      xhr.upload.onprogress = (e) => e.lengthComputable && onProgress && onProgress(e.loaded / e.total);
      xhr.onload = () => {
        let data = {}; try { data = JSON.parse(xhr.responseText); } catch {}
        xhr.status < 300 ? resolve(data) : reject(new ApiError(xhr.status, data.error || `Upload failed (${xhr.status})`));
      };
      xhr.onerror = () => reject(new ApiError(0, 'Network error — check your connection.'));
      xhr.send(formData);
    });
  },
};

export const enc = encodeURIComponent;
