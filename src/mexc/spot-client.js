import { config } from '../config.js';
import { publicRequest } from './auth.js';

export const getKlines = async ({ symbol, interval = '1m', limit = 200 }) =>
  publicRequest({
    baseUrl: config.spotBaseUrl,
    path: '/api/v3/klines',
    params: { symbol, interval, limit }
  });

export const getTicker24h = async ({ symbol }) =>
  publicRequest({
    baseUrl: config.spotBaseUrl,
    path: '/api/v3/ticker/24hr',
    params: { symbol }
  });

export const getDepth = async ({ symbol, limit = 50 }) =>
  publicRequest({
    baseUrl: config.spotBaseUrl,
    path: '/api/v3/depth',
    params: { symbol, limit }
  });
