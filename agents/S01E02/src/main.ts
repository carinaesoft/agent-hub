import fs from "fs";
import { parse } from "csv-parse/sync"
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

interface Suspect {
    name: string;
    surname: string;
    born: number;
    locations: { latitude: number, longitude: number }[]
}

const tools = [

    {
        type: "function",
        function: {
            name: "get_access_level",
            description: "Pobiera poziom dostępu osoby do systemu",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    surname: { type: "string" },
                    birthYear: { type: "number" },
                },
                required: ["name", "surname", "birthYear"]
            }
        }
    },
    {
        type: "function",
        function: {
            name: "submit_answer",
            description: "Wysyła finalną odpowiedź do weryfikacji",
            parameters: {
                type: "object",
                properties: {
                    name: { type: "string" },
                    surname: { type: "string" },
                    accessLevel: { type: "number" },
                    powerPlant: { type: "string", description: "Kod elektrowni np. PWR7264PL" },
                },
                required: ["name", "surname", "accessLevel", "powerPlant"]
            }
        }
    }
];


async function getPersonLocations(name: string, surname: string) {
    const res = await fetch("https://hub.ag3nts.org/api/location", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: process.env.API_KEY, name, surname })
    });
    return await res.json();
}

async function getAccessLevel(name: string, surname: string, birthYear: number) {
    const res = await fetch("https://hub.ag3nts.org/api/accesslevel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: process.env.API_KEY, name, surname, birthYear })
    });
    return await res.json();
}

async function submitAnswer(name: string, surname: string, accessLevel: number, powerPlant: string) {
    const res = await fetch("https://hub.ag3nts.org/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apikey: process.env.API_KEY, task: "findhim", answer: { name, surname, accessLevel, powerPlant } })
    });
    return await res.json();
}


const powerPlants: Record<string, { lat: number, lng: number, code: string }> = {
    "Zabrze": { lat: 50.3249, lng: 18.7857, code: "PWR3847PL" },
    "Piotrków Trybunalski": { lat: 51.4058, lng: 19.7034, code: "PWR5921PL" },
    "Grudziądz": { lat: 53.4837, lng: 18.7536, code: "PWR7264PL" },
    "Tczew": { lat: 53.7794, lng: 18.7764, code: "PWR1593PL" },
    "Radom": { lat: 51.4027, lng: 21.1471, code: "PWR8406PL" },
    "Chelmno": { lat: 53.3484, lng: 18.4248, code: "PWR2758PL" },
    "Żarnowiec": { lat: 54.4833, lng: 18.1333, code: "PWR6132PL" },
};

function haversine(lat1: number, lng1: number, lat2: number, lng2: number): number {
    const R = 6371;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
        Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function main() {
    const suspects: Suspect[] = [
        { name: "Cezary", surname: "Żurek", born: 1987, locations: [] },
        { name: "Jacek", surname: "Nowak", born: 1991, locations: [] },
        { name: "Oskar", surname: "Sieradzki", born: 1993, locations: [] },
        { name: "Wojciech", surname: "Bielik", born: 1986, locations: [] },
        { name: "Wacław", surname: "Jasiński", born: 1986, locations: [] },
    ];

    // Krok 1: pobierz lokalizacje
    for (const suspect of suspects) {
        suspect.locations = await getPersonLocations(suspect.name, suspect.surname);
    }

    // Krok 2: znajdź kto był najbliżej elektrowni
    let closestSuspect: Suspect | null = null;
    let closestPlant: { name: string, code: string } | null = null;
    let closestDistance = Infinity;

    for (const suspect of suspects) {
        for (const location of suspect.locations) {
            for (const [plantName, plant] of Object.entries(powerPlants)) {
                const distance = haversine(location.latitude, location.longitude, plant.lat, plant.lng);
                if (distance < closestDistance) {
                    closestDistance = distance;
                    closestSuspect = suspect;
                    closestPlant = { name: plantName, ...plant };
                }
            }
        }
    }

    console.log(`Najbliżej: ${closestSuspect?.name} ${closestSuspect?.surname} - ${closestPlant?.name} (${closestDistance.toFixed(2)} km)`);

    // Krok 3: agent pobiera accessLevel i submituje
    const messages: any[] = [
        {
            role: "system",
            content: `Jesteś agentem śledczym. Znalazłeś osobę która była najbliżej elektrowni atomowej.
Osoba: ${JSON.stringify(closestSuspect)}
Elektrownia: ${JSON.stringify(closestPlant)}
Pobierz accessLevel tej osoby i wyślij odpowiedź.`
        },
        {
            role: "user",
            content: "Pobierz accessLevel i wyślij odpowiedź."
        }
    ];

    for (let i = 0; i < 10; i++) {
        const response = await client.chat.completions.create({
            model: "openai/gpt-4o-mini",
            messages,
            tools: tools as any,
        });

        const msg = response.choices[0].message;
        messages.push(msg);

        if (!msg.tool_calls || msg.tool_calls.length === 0) {
            console.log("Agent zakończył:", msg.content);
            break;
        }

        for (const toolCall of msg.tool_calls) {
            if (toolCall.type !== "function") continue;
            const args = JSON.parse(toolCall.function.arguments);
            console.log(`Wywołuję: ${toolCall.function.name}`, args);

            let result;
            if (toolCall.function.name === "get_access_level") {
                result = await getAccessLevel(args.name, args.surname, args.birthYear);
            } else if (toolCall.function.name === "submit_answer") {
                result = await submitAnswer(args.name, args.surname, args.accessLevel, args.powerPlant);
            }

            console.log(`Wynik:`, result);
            messages.push({ role: "tool", tool_call_id: toolCall.id, content: JSON.stringify(result) });
        }
    }
}
main().catch(console.error);
