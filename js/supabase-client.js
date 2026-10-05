(function () {
  const cfg = window.KANDONG_CONFIG;

  function createFallbackClient(url, key) {
    const headers = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    };

    return {
      _isFallback: true,
      from(table) {
        return {
          select(columns = '*') {
            const q = {
              _filters: [],
              _order: null,
              _limit: null,
              eq(col, val) {
                this._filters.push({ col, val });
                return this;
              },
              order(col, opts = {}) {
                this._order = { col, ascending: opts.ascending !== false };
                return this;
              },
              limit(n) {
                this._limit = n;
                return this;
              },
              then(resolve) {
                let endpoint = `${url}/rest/v1/${table}?select=${columns}`;
                this._filters.forEach((f) => {
                  endpoint += `&${f.col}=eq.${encodeURIComponent(f.val)}`;
                });
                if (this._order) {
                  endpoint += `&order=${this._order.col}.${this._order.ascending ? 'asc' : 'desc'}`;
                }
                if (this._limit) endpoint += `&limit=${this._limit}`;

                fetch(endpoint, {
                  headers: { apikey: key, Authorization: `Bearer ${key}` },
                })
                  .then((r) =>
                    r.json().then((data) => {
                      if (!r.ok) {
                        resolve({ data: null, error: { message: data.message || r.statusText } });
                      } else {
                        resolve({ data, error: null });
                      }
                    })
                  )
                  .catch((e) => resolve({ data: null, error: { message: e.message } }));
              },
            };
            return q;
          },
          insert(row) {
            return {
              select() {
                return fetch(`${url}/rest/v1/${table}`, {
                  method: 'POST',
                  headers,
                  body: JSON.stringify(row),
                }).then(async (r) => {
                  const data = await r.json().catch(() => null);
                  if (!r.ok) {
                    return { data: null, error: { message: data?.message || 'Insert failed' } };
                  }
                  return { data: Array.isArray(data) ? data : [data], error: null };
                });
              },
            };
          },
          update(row) {
            return {
              eq(col, val) {
                return fetch(
                  `${url}/rest/v1/${table}?${col}=eq.${encodeURIComponent(val)}`,
                  {
                    method: 'PATCH',
                    headers,
                    body: JSON.stringify(row),
                  }
                ).then(async (r) => {
                  const data = await r.json().catch(() => null);
                  if (!r.ok) {
                    return { data: null, error: { message: data?.message || 'Update failed' } };
                  }
                  return { data, error: null };
                });
              },
            };
          },
        };
      },
      channel() {
        return {
          on() {
            return this;
          },
          subscribe() {
            return {};
          },
        };
      },
      removeChannel() {},
    };
  }

  window.createKandongClient = function () {
    const key = localStorage.getItem('kandong_anon_key') || cfg.SUPABASE_ANON_KEY;
    if (!key || key === 'PASTE_YOUR_ANON_KEY_HERE' || key.length < 20) {
      return null;
    }

    if (window.supabase && window.supabase.createClient) {
      try {
        return window.supabase.createClient(cfg.SUPABASE_URL, key);
      } catch (_) {}
    }
    return createFallbackClient(cfg.SUPABASE_URL, key);
  };
})();
