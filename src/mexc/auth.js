import crypto from 'crypto';
import { config } from '../config.js';

// Build query string for GET/DELETE requests
// Parameters are sorted in dictionary order and concatenated with &
// Null parameters are excluded
const buildQueryString = (params = {}) => {
  return Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
    .sort()
    .join('&');
};

// Generate HMAC-SHA256 signature
// According to MEXC docs: accessKey + timestamp + parameterString
const generateSignature = (accessKey, timestamp, parameterString, secret) => {
  const targetString = `${accessKey}${timestamp}${parameterString}`;
  return crypto.createHmac('sha256', secret).update(targetString).digest('hex');
};

export const signedRequest = async ({
  baseUrl,
  path,
  method = 'GET',
  params = {},
  headers = {},
  body = undefined
}) => {
  // Timestamp in milliseconds (as string for header)
  const timestamp = String(Date.now());
  
  // Build parameter string for signature
  let parameterString = '';
  
  if (method === 'GET' || method === 'DELETE') {
    // For GET/DELETE: sort business parameters in dictionary order, concatenate with &
    // Note: timestamp and recvWindow are NOT included in params for signature
    // They are sent as headers only
    const businessParams = { ...params };
    // Filter out null/undefined/empty values
    const filteredParams = Object.entries(businessParams)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .reduce((acc, [k, v]) => {
        acc[k] = v;
        return acc;
      }, {});
    
    parameterString = buildQueryString(filteredParams);
  } else if (method === 'POST') {
    // For POST: parameters to sign are the JSON string (no dictionary sorting)
    if (body) {
      parameterString = JSON.stringify(body);
    } else if (Object.keys(params).length > 0) {
      // If body is not provided but params are, use params as JSON
      parameterString = JSON.stringify(params);
    }
  }
  
  // Generate signature: accessKey + timestamp + parameterString
  const signature = generateSignature(config.apiKey, timestamp, parameterString, config.apiSecret);
  
  // Build URL (without signature in query string)
  let url = `${baseUrl}${path}`;
  if ((method === 'GET' || method === 'DELETE') && parameterString) {
    url = `${url}?${parameterString}`;
  }
  
  // Build request headers according to MEXC docs
  const requestHeaders = {
    'ApiKey': config.apiKey, // Access Key
    'Request-Time': timestamp, // Timestamp in milliseconds (string)
    'Signature': signature, // HMAC-SHA256 signature
    'Content-Type': 'application/json',
    ...headers
  };
  
  // Add Recv-Window header if configured (optional)
  if (config.recvWindow && config.recvWindow > 0) {
    requestHeaders['Recv-Window'] = String(config.recvWindow);
  }
  
  const requestInit = {
    method,
    headers: requestHeaders
  };
  
  // For POST requests, body is JSON string
  if (method === 'POST' && body) {
    requestInit.body = JSON.stringify(body);
  }
  // console.log(requestInit, "request")
  const res = await fetch(url, requestInit);
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Failed to parse JSON: ${text}`);
  }
  
  // Check for errors: HTTP error or API error code (4xx, 5xx)
  if (!res.ok || data.code?.toString().startsWith('4') || data.code?.toString().startsWith('5')) {
    throw new Error(`MEXC API error ${res.status}: ${JSON.stringify(data)}`);
  }
  
  return data;
};

export const publicRequest = async ({ baseUrl, path, params = {}, method = 'GET' }) => {
  const query = buildQueryString(params);
  const url = query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`;
  const res = await fetch(url, { method });
  const text = await res.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`Failed to parse JSON: ${text}`);
  }
  if (!res.ok) {
    throw new Error(`MEXC public API error ${res.status}: ${text}`);
  }
  return data;
};
