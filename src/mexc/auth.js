import crypto from 'crypto';
import fetch from 'node-fetch';
import { HttpsProxyAgent } from 'https-proxy-agent';
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
  // Use node-fetch for consistency (signed requests typically don't need proxy)
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

let maxRetry = 0;

export const publicRequest = async ({ baseUrl, path, params = {}, method = 'GET', proxy = null }) => {
  const query = buildQueryString(params);
  const url = query ? `${baseUrl}${path}?${query}` : `${baseUrl}${path}`;
  
  const TIMEOUT_MS = 5000; // 5 seconds timeout
  const MAX_RETRIES = 100;
  
  let lastError = null;
  
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    let timeoutId = null;
    try {
      // Build fetch options with proxy support
      const fetchOptions = { method };
      
      // If proxy is provided, use HttpsProxyAgent with node-fetch
      if (proxy && proxy.url) {
        const agent = new HttpsProxyAgent(proxy.url);
        fetchOptions.agent = agent;
      }
      
      // Create AbortController for timeout
      const controller = new AbortController();
      timeoutId = setTimeout(() => {
        controller.abort();
      }, TIMEOUT_MS);
      
      fetchOptions.signal = controller.signal;
      
      // Use node-fetch (supports proxy via agent option)
      const res = await fetch(url, fetchOptions);
      
      // Clear timeout if request completed successfully
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
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
      
      // Success: return data
      return data;
    } catch (err) {
      // Clear timeout if it's still active
      if (timeoutId) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
      
      lastError = err;
      
      // Check if it's a timeout/abort error
      const isTimeout = err.name === 'AbortError' || 
                       err.message?.includes('aborted') || 
                       err.message?.includes('timeout') ||
                       err.code === 'ECONNRESET' ||
                       err.code === 'ETIMEDOUT';
      
      if (isTimeout) {
        if (attempt > maxRetry) {
          maxRetry = attempt;
          console.log(proxy.url)
          console.log(maxRetry, "maxRetry")
        }
        // console.log(`[publicRequest] Request timeout (attempt ${attempt}/${MAX_RETRIES}): ${url}`);
      } else {
        console.log(`[publicRequest] Request error (attempt ${attempt}/${MAX_RETRIES}): ${err.message}`);
      }
      
      // If this is the last attempt, throw the error
      if (attempt === MAX_RETRIES) {
        throw new Error(`Request failed after ${MAX_RETRIES} attempts: ${lastError.message}`);
      }
      
      const delay = Math.min(100 * attempt, 100);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  
  // Should never reach here, but just in case
  throw new Error(`Request failed after ${MAX_RETRIES} attempts: ${lastError?.message || 'Unknown error'}`);
};
