import { describe, expect, it } from 'vitest';
import { createApi } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { geminiRatio, openAiSize } from '../src/render/providers.js';

// 1×1 PNG padded so it passes the minimum size check.
const PNG = `data:image/png;base64,${Buffer.alloc(200, 1).toString('base64')}`;

interface Call {
  url: string;
  init?: RequestInit;
}

function app(env: Record<string, string>, respond: (url: string) => Response) {
  const calls: Call[] = [];
  const a = createApi(loadConfig(env), {
    cache: false,
    fetch: (url, init) => {
      calls.push({ url, init });
      return Promise.resolve(respond(url));
    },
  });
  return { app: a, calls };
}

const post = (body: unknown, headers: Record<string, string> = {}) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

describe('/api/render', () => {
  it('lists providers and whether the server has a key', async () => {
    const { app: a } = app({ RENDER_GEMINI_KEY: 'g' }, () => new Response());
    const body = (await (await a.request('/api/render/providers')).json()) as {
      providers: { id: string; serverKey: boolean }[];
    };
    expect(body.providers.find((p) => p.id === 'gemini')?.serverKey).toBe(true);
    expect(body.providers.find((p) => p.id === 'stability')?.serverKey).toBe(false);
  });

  it('refuses without any key and never calls upstream', async () => {
    const { app: a, calls } = app({}, () => new Response());
    const res = await a.request(
      '/api/render',
      post({ provider: 'stability', prompt: 'x', image: PNG }),
    );
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: string }).error).toBe('no_key');
    expect(calls).toHaveLength(0);
  });

  it('sends the screenshot to Stability structure with the user key', async () => {
    const { app: a, calls } = app(
      { RENDER_STABILITY_KEY: 'server' },
      () => new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } }),
    );
    const res = await a.request(
      '/api/render',
      post(
        { provider: 'stability', prompt: 'photo', image: PNG, fidelity: 0.8 },
        { 'X-Render-Key': 'mine' },
      ),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { image: string; model: string };
    expect(body.image).toBe('data:image/png;base64,AQID');
    expect(body.model).toBe('structure');
    expect(calls[0]!.url).toBe('https://api.stability.ai/v2beta/stable-image/control/structure');
    expect((calls[0]!.init!.headers as Record<string, string>).Authorization).toBe('Bearer mine');
    const form = calls[0]!.init!.body as FormData;
    expect(form.get('control_strength')).toBe('0.8');
    expect(form.get('prompt')).toBe('photo');
  });

  it('reads the Gemini image part and passes the aspect ratio', async () => {
    const { app: a, calls } = app({ RENDER_GEMINI_KEY: 'g' }, () =>
      Response.json({
        candidates: [
          {
            content: {
              parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: 'AAA=' } }],
            },
          },
        ],
      }),
    );
    const res = await a.request(
      '/api/render',
      post({ provider: 'gemini', prompt: 'p', image: PNG, aspect: 1.78 }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { image: string }).image).toBe('data:image/png;base64,AAA=');
    expect(calls[0]!.url).toContain('models/gemini-2.5-flash-image:generateContent');
    const sent = JSON.parse(calls[0]!.init!.body as string) as {
      generationConfig: { imageConfig: { aspectRatio: string } };
    };
    expect(sent.generationConfig.imageConfig.aspectRatio).toBe('16:9');
  });

  it('maps an invalid key to 401 with the provider message', async () => {
    const { app: a } = app({}, () =>
      Response.json({ error: { message: 'Incorrect API key' } }, { status: 401 }),
    );
    const res = await a.request(
      '/api/render',
      post({ provider: 'openai', prompt: 'p', image: PNG }, { 'X-Render-Key': 'bad' }),
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: string; message: string };
    expect(body.error).toBe('invalid_key');
    expect(body.message).toContain('Incorrect API key');
  });

  it('rejects bad input', async () => {
    const { app: a } = app({}, () => new Response());
    const k = { 'X-Render-Key': 'k' };
    expect(
      (await a.request('/api/render', post({ provider: 'x', prompt: 'p', image: PNG }, k))).status,
    ).toBe(400);
    expect(
      (await a.request('/api/render', post({ provider: 'gemini', prompt: '', image: PNG }, k)))
        .status,
    ).toBe(400);
    expect(
      (
        await a.request(
          '/api/render',
          post({ provider: 'gemini', prompt: 'p', image: 'http://x' }, k),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await a.request(
          '/api/render',
          post({ provider: 'gemini', model: '../x', prompt: 'p', image: PNG }, k),
        )
      ).status,
    ).toBe(400);
  });

  it('sends the view to OpenRouter as an input reference', async () => {
    const { app: a, calls } = app({ RENDER_OPENROUTER_KEY: 'or' }, () =>
      Response.json({ data: [{ b64_json: 'AAA=', media_type: 'image/png' }] }),
    );
    const res = await a.request(
      '/api/render',
      post({
        provider: 'openrouter',
        model: 'google/gemini-3-pro-image',
        prompt: 'p',
        image: PNG,
        aspect: 1.5,
      }),
    );
    expect(res.status).toBe(200);
    expect(((await res.json()) as { image: string }).image).toBe('data:image/png;base64,AAA=');
    expect(calls[0]!.url).toBe('https://openrouter.ai/api/v1/images');
    const sent = JSON.parse(calls[0]!.init!.body as string) as {
      model: string;
      aspect_ratio: string;
      input_references: { image_url: { url: string } }[];
    };
    expect(sent.model).toBe('google/gemini-3-pro-image');
    expect(sent.input_references).toHaveLength(1);
    expect(sent.aspect_ratio).toBe('3:2');
    expect(sent.input_references[0]!.image_url.url.startsWith('data:image/png;base64,')).toBe(true);
  });

  it('accepts vendor/model ids only for OpenRouter', async () => {
    const { app: a } = app({}, () => new Response());
    const k = { 'X-Render-Key': 'k' };
    expect(
      (
        await a.request(
          '/api/render',
          post({ provider: 'gemini', model: 'google/x', prompt: 'p', image: PNG }, k),
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await a.request(
          '/api/render',
          post({ provider: 'openrouter', model: '../../x', prompt: 'p', image: PNG }, k),
        )
      ).status,
    ).toBe(400);
  });

  it('sends the line drawing as second image and the seed', async () => {
    const { app: a, calls } = app({ RENDER_OPENROUTER_KEY: 'or', RENDER_GEMINI_KEY: 'g' }, (url) =>
      url.includes('openrouter')
        ? Response.json({ data: [{ b64_json: 'AAA=' }] })
        : Response.json({
            candidates: [{ content: { parts: [{ inlineData: { data: 'AAA=' } }] } }],
          }),
    );
    for (const provider of ['openrouter', 'gemini']) {
      const res = await a.request(
        '/api/render',
        post({ provider, prompt: 'p', image: PNG, guide: PNG, seed: 42 }),
      );
      expect(res.status).toBe(200);
    }
    const or = JSON.parse(calls[0]!.init!.body as string) as {
      input_references: unknown[];
      seed: number;
    };
    expect(or.input_references).toHaveLength(2);
    expect(or.seed).toBe(42);
    const ge = JSON.parse(calls[1]!.init!.body as string) as {
      contents: { parts: unknown[] }[];
      generationConfig: { seed: number };
    };
    expect(ge.contents[0]!.parts).toHaveLength(3);
    expect(ge.generationConfig.seed).toBe(42);
    const bad = await a.request(
      '/api/render',
      post({ provider: 'gemini', prompt: 'p', image: PNG, seed: -1 }),
    );
    expect(bad.status).toBe(400);
  });

  it('picks output formats', () => {
    expect(openAiSize(1.7)).toBe('1536x1024');
    expect(openAiSize(0.6)).toBe('1024x1536');
    expect(openAiSize(1)).toBe('1024x1024');
    expect(geminiRatio(1.5)).toBe('3:2');
    expect(geminiRatio(2.3)).toBe('21:9');
  });
});
