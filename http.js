// WikiSync's Cloudflare policy rejects the legacy `(+https://...)` form.
// Keep this descriptive and contactable as requested by the RuneScape Wiki API policy.
const DEFAULT_USER_AGENT = 'osrs-tracker/1.1.0 (https://github.com/Nikamura/osrs-tracker; contact: GitHub @Nikamura)';
const DEFAULT_TIMEOUT_MS = 20_000;

export const USER_AGENT = process.env.OSRS_TRACKER_USER_AGENT || DEFAULT_USER_AGENT;

function retryDelayMs(response, attempt) {
  const retryAfter = response?.headers.get('retry-after');
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) {
      return Math.max(0, seconds * 1000);
    }

    const retryAt = Date.parse(retryAfter);
    if (Number.isFinite(retryAt)) {
      return Math.max(0, retryAt - Date.now());
    }
  }

  return 500 * (2 ** attempt);
}

function isRetryableStatus(status) {
  return status === 408 || status === 429 || status >= 500;
}

function wait(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

export async function fetchWithRetry(url, options = {}) {
  const {
    headers = {},
    retries = 2,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    ...requestOptions
  } = options;

  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    let response;
    try {
      response = await fetch(url, {
        ...requestOptions,
        headers: {
          'User-Agent': USER_AGENT,
          ...headers
        },
        signal: requestOptions.signal || AbortSignal.timeout(timeoutMs)
      });

      if (response.ok) {
        return response;
      }

      const responseText = (await response.text()).trim().slice(0, 300);
      const suffix = responseText ? `: ${responseText}` : '';
      const error = new Error(`Request failed with HTTP ${response.status} for ${url}${suffix}`);
      error.status = response.status;
      lastError = error;

      if (!isRetryableStatus(response.status) || attempt === retries) {
        throw error;
      }
    } catch (error) {
      lastError = error;
      const status = error?.status;
      const canRetry = status === undefined || isRetryableStatus(status);
      if (!canRetry || attempt === retries) {
        throw error;
      }
    }

    await wait(retryDelayMs(response, attempt));
  }

  throw lastError;
}

export async function fetchJson(url, options = {}) {
  const response = await fetchWithRetry(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      ...options.headers
    }
  });

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Invalid JSON returned by ${url}: ${error.message}`, { cause: error });
  }
}

export async function fetchText(url, options = {}) {
  const response = await fetchWithRetry(url, options);
  return response.text();
}
