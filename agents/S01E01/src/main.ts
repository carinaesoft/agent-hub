import fs from "fs";
import { parse } from "csv-parse/sync"
import "dotenv/config";
import OpenAI from "openai";

const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
});

interface Person {
    name: string;
    surname: string;
    gender: string;
    born: number;
    city: string;
    job: string;
    tags?: string[];

}

async function tagJobs(people: Person[]): Promise<string[][]> {
    const jobs = people.map((p, i) => `${i}: ${p.job}`).join("\n");

    const response = await client.chat.completions.create({
        model: "openai/gpt-4o-mini",
        messages: [
            {
                role: "system",
                content: `Klasyfikujesz opisy stanowisk pracy. Przypisz pasujące tagi z listy: IT, transport, edukacja, medycyna, praca z ludźmi, praca z pojazdami, praca fizyczna.`
            },
            {
                role: "user",
                content: jobs
            }
        ],
        response_format: {
            type: "json_schema",
            json_schema: {
                name: "tags",
                schema: {
                    type: "object",
                    properties: {
                        results: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    index: { type: "number" },
                                    tags: {
                                        type: "array",
                                        items: {
                                            type: "string",
                                            enum: ["IT", "transport", "edukacja", "medycyna", "praca z ludźmi", "praca z pojazdami", "praca fizyczna"]
                                        }
                                    }
                                },
                                required: ["index", "tags"]
                            }
                        }
                    },
                    required: ["results"]
                }
            }
        }
    });

    const content = response.choices[0].message.content ?? "{}";
    const parsed = JSON.parse(content);
    return parsed.results
        .sort((a: any, b: any) => a.index - b.index)
        .map((r: any) => r.tags);
}


async function main() {
    console.log("Start")
    const fileContent = fs.readFileSync("/Users/bartosz/Development/ai-devs4/tasks/s01e01/people.csv", "utf-8")
    const records = parse(fileContent, { columns: true, skip_empty_lines: true })
    const people: Person[] = records.map((row: any) => {
        const year = parseInt(row.birthDate.split("-")[0]);
        return {
            name: row.name,
            surname: row.surname,
            gender: row.gender,
            born: year,
            city: row.birthPlace,
            job: row.job,
        };
    });
    console.log(`Loaded ${people.length} people`);
    const suspects = people.filter(p => {
        const age = 2026 - p.born;
        return p.gender === "M" &&
            p.city === "Grudziądz" &&
            age >= 20 &&
            age <= 40;
    })
    console.log(`Suspects: ${suspects.length}`);

    const tagResults = await tagJobs(suspects);
    tagResults.forEach((tags, i) => {
        suspects[i].tags = tags;
    });
    console.log(`Suspects with transport: ${suspects.filter(p => p.tags?.includes("transport")).map(p => `${p.name} ${p.surname} ${p.born}`)}`);


    const transportPeople = suspects.filter(p => p.tags?.includes("transport"));

    const response = await fetch("https://hub.ag3nts.org/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            apikey: process.env.API_KEY,
            task: "people",
            answer: transportPeople.map(p => ({
                name: p.name,
                surname: p.surname,
                gender: p.gender,
                born: p.born,
                city: p.city,
                tags: p.tags
            }))
        })
    });

    const result = await response.json();
    console.log(result);
}

main().catch(console.error);

