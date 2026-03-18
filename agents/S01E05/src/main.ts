import "dotenv/config";
import chalk from "chalk"


const error = chalk.bold.red;
const warning = chalk.hex('#FFA500'); // Orange color

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const API_URL = "https://hub.ag3nts.org/verify";
const API_KEY = process.env.API_KEY!;

async function callRailway(action: object, retries = 10): Promise<any> {
    for (let i = 0; i < retries; i++) {
        const res = await fetch(API_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                apikey: API_KEY,
                task: "railway",
                answer: action,
            }),
        });
        console.log(error(`Running Action ${JSON.stringify(action)}`))


        const data = await res.json();
        // Sprawdź nagłówki limitów
        const remaining = res.headers.get("x-ratelimit-remaining");
        const reset = res.headers.get("x-ratelimit-reset");
        console.log(warning(`[Headers] remaining: ${remaining}, reset: ${reset}`));

        if (res.status === 503 || data?.code === -985) {
            const wait = (data?.retry_after ?? (i + 1) * 10) * 1000;
            console.log(`[Retry] Czekam ${wait / 1000}s...`);
            await sleep(wait);
            continue;
        }

        console.log(`[Response]`, JSON.stringify(data, null, 2));
        return { data, headers: res.headers };
    }
    throw new Error(error("Przekroczono limit prób"));
}

async function waitAfter(res: any) {
    const seconds = res?.data?.retry_after ?? 35;
    console.log(warning(`[Wait] Czekam ${seconds}s...`));
    await sleep(seconds * 1000);
}

async function main() {
    await callRailway({ action: "help" });

    const r1 = await callRailway({ action: "reconfigure", route: "X-01" });
    await waitAfter(r1);

    const r2 = await callRailway({ action: "getstatus", route: "X-01" });
    await waitAfter(r2);

    const r3 = await callRailway({ action: "setstatus", route: "X-01", value: "RTOPEN" });
    await waitAfter(r3);

    await callRailway({ action: "save", route: "X-01" });
}


main().catch(console.error);