const { spawn } = require('child_process');

const PORT = process.env.TEST_PORT || '3101';
const BASE_URL = `http://127.0.0.1:${PORT}`;
const STARTUP_TIMEOUT_MS = 15000;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForServer() {
    const start = Date.now();
    while (Date.now() - start < STARTUP_TIMEOUT_MS) {
        try {
            const res = await fetch(`${BASE_URL}/api/templates`);
            if (res.ok) return;
        } catch (error) {
            // Keep polling until timeout.
        }
        await sleep(300);
    }
    throw new Error(`Server did not become ready within ${STARTUP_TIMEOUT_MS}ms`);
}

async function assertJson(pathname, predicate, label) {
    const res = await fetch(`${BASE_URL}${pathname}`);
    if (!res.ok) {
        throw new Error(`${label} failed with status ${res.status}`);
    }
    const json = await res.json();
    if (!predicate(json)) {
        throw new Error(`${label} returned unexpected payload: ${JSON.stringify(json)}`);
    }
    return json;
}

async function assertHtml(pathname, expectedText, label) {
    const res = await fetch(`${BASE_URL}${pathname}`);
    if (!res.ok) {
        throw new Error(`${label} failed with status ${res.status}`);
    }
    const text = await res.text();
    if (!text.includes(expectedText)) {
        throw new Error(`${label} did not contain expected text: ${expectedText}`);
    }
}

async function createTestKey() {
    const res = await fetch(`${BASE_URL}/api/keys`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Smoke Test Client' })
    });
    if (res.status === 400) return null;
    if (!res.ok) throw new Error(`Create API key failed with status ${res.status}`);
    const json = await res.json();
    if (!json.success || !json.apiKey || !json.apiKey.id) {
        throw new Error(`Create API key returned unexpected payload: ${JSON.stringify(json)}`);
    }
    return json.apiKey;
}

async function deleteTestKey(id) {
    const res = await fetch(`${BASE_URL}/api/keys/${id}`, { method: 'DELETE' });
    if (!res.ok) {
        throw new Error(`Delete API key failed with status ${res.status}`);
    }
    const json = await res.json();
    if (!json.success) {
        throw new Error(`Delete API key returned unexpected payload: ${JSON.stringify(json)}`);
    }
}

async function main() {
    const server = spawn('node', ['server.js'], {
        env: { ...process.env, PORT, CLEAN_SESSION: 'false' },
        stdio: ['ignore', 'pipe', 'pipe']
    });

    let startupLog = '';
    server.stdout.on('data', (chunk) => {
        startupLog += chunk.toString();
    });
    server.stderr.on('data', (chunk) => {
        startupLog += chunk.toString();
    });

    let createdKeyId = null;

    try {
        await waitForServer();

        await assertHtml('/dashboard', 'Gateway Dashboard', 'Dashboard page');
        await assertJson('/api/templates', (json) => Array.isArray(json) && json.length >= 1, 'Templates API');
        await assertJson('/api/bot/status', (json) => typeof json.ready === 'boolean', 'Bot status API');
        await assertJson('/api/keys', Array.isArray, 'API keys API');

        const apiKey = await createTestKey();
        if (apiKey) {
            createdKeyId = apiKey.id;
            await assertJson(
                '/api/keys',
                (json) => Array.isArray(json) && json.some((item) => item.id === createdKeyId),
                'API keys API after create'
            );
            await deleteTestKey(createdKeyId);
            createdKeyId = null;
        }

        console.log('Smoke test passed');
    } catch (error) {
        console.error('Smoke test failed');
        console.error(error.message);
        if (startupLog.trim()) {
            console.error('--- server log ---');
            console.error(startupLog.trim());
        }
        process.exitCode = 1;
    } finally {
        if (createdKeyId) {
            try {
                await deleteTestKey(createdKeyId);
            } catch (error) {
                // Best effort cleanup.
            }
        }
        server.kill('SIGINT');
        await new Promise((resolve) => server.on('exit', resolve));
    }
}

main();
