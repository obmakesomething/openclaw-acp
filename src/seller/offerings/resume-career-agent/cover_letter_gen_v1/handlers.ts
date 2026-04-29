import type { ExecuteJobResult } from "../../../runtime/offeringTypes.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = "claude-sonnet-4-20250514";

interface CoverLetterRequest {
  job_title: string;
  company: string;
  job_description: string;
  candidate_summary: string;
  key_projects?: string[];
  language?: string;
  tone?: string;
}

const SYSTEM_PROMPTS: Record<string, string> = {
  en: `You are an expert cover letter writer. Write a compelling, concise cover letter (250-400 words) that:
1. Opens with a strong hook connecting the candidate to the role
2. Highlights 2-3 most relevant experiences or projects
3. Shows understanding of the company's needs
4. Closes with confidence and a clear call to action
5. Uses natural, professional language — not generic templates
Do NOT include placeholder brackets like [Your Name]. Write the actual letter content only.
Return JSON with: { "cover_letter": string, "word_count": number, "highlights_used": string[] }`,

  ko: `당신은 전문 자기소개서 작성자입니다. 설득력 있고 간결한 자기소개서(500-800자)를 작성하세요:
1. 지원자와 직무를 연결하는 강력한 도입부
2. 가장 관련성 높은 경험이나 프로젝트 2-3개 강조
3. 회사의 니즈에 대한 이해 표현
4. 자신감 있는 마무리
5. 자연스럽고 전문적인 어투 사용 — 템플릿적 표현 지양
[이름] 같은 플레이스홀더 없이 실제 내용만 작성하세요.
JSON으로 반환: { "cover_letter": string, "word_count": number, "highlights_used": string[] }`,
};

async function callAnthropic(systemPrompt: string, userPrompt: string): Promise<string> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 2048,
      temperature: 0.7,
      system: systemPrompt,
      messages: [{ role: "user", content: userPrompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content?.[0]?.text || "";
}

function generateFallbackLetter(req: CoverLetterRequest): string {
  const lang = req.language || "en";
  const projects = req.key_projects?.join(", ") || "relevant projects";

  if (lang === "ko") {
    return [
      `${req.company} ${req.job_title} 직무에 지원합니다.`,
      ``,
      `${req.candidate_summary}`,
      ``,
      `특히 ${projects} 경험을 통해 이 직무에 필요한 역량을 갖추고 있다고 확신합니다.`,
      ``,
      `귀사의 성장에 기여할 수 있는 기회를 기대합니다.`,
    ].join("\n");
  }

  return [
    `I am writing to express my interest in the ${req.job_title} position at ${req.company}.`,
    ``,
    `${req.candidate_summary}`,
    ``,
    `My experience with ${projects} has prepared me well for the challenges of this role.`,
    ``,
    `I would welcome the opportunity to discuss how my background aligns with your team's needs.`,
  ].join("\n");
}

export function validateRequirements(request: unknown): { valid: boolean; reason?: string } {
  const req = request as Record<string, unknown>;
  if (!req?.job_title || typeof req.job_title !== "string") {
    return { valid: false, reason: "job_title is required" };
  }
  if (!req?.company || typeof req.company !== "string") {
    return { valid: false, reason: "company is required" };
  }
  if (!req?.job_description || typeof req.job_description !== "string") {
    return { valid: false, reason: "job_description is required" };
  }
  if (!req?.candidate_summary || typeof req.candidate_summary !== "string") {
    return { valid: false, reason: "candidate_summary is required" };
  }
  return { valid: true };
}

export function requestPayment(_request: Record<string, unknown>): string {
  return "A tailored cover letter will be generated based on the job description and your candidate profile.";
}

export async function executeJob(request: Record<string, unknown>): Promise<ExecuteJobResult> {
  const req = request as unknown as CoverLetterRequest;
  const lang = req.language || "en";
  const tone = req.tone || "professional";

  const userPrompt = [
    `Write a cover letter for:`,
    ``,
    `Position: ${req.job_title}`,
    `Company: ${req.company}`,
    `Tone: ${tone}`,
    ``,
    `Job Description:`,
    req.job_description.slice(0, 3000),
    ``,
    `Candidate Background:`,
    req.candidate_summary,
    ``,
    req.key_projects?.length
      ? `Key Projects to Highlight:\n${req.key_projects.map((p) => `- ${p}`).join("\n")}`
      : "",
    ``,
    `Generate the cover letter as JSON.`,
  ]
    .filter(Boolean)
    .join("\n");

  let result: { cover_letter: string; word_count: number; highlights_used: string[] };

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("No API key configured");
    }
    const systemPrompt = SYSTEM_PROMPTS[lang] || SYSTEM_PROMPTS.en;
    const raw = await callAnthropic(systemPrompt, userPrompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON in response");
    }
    result = JSON.parse(jsonMatch[0]);
  } catch {
    const letter = generateFallbackLetter(req);
    result = {
      cover_letter: letter,
      word_count: letter.split(/\s+/).length,
      highlights_used: req.key_projects || [],
    };
  }

  return {
    deliverable: JSON.stringify({
      status: "success",
      job_title: req.job_title,
      company: req.company,
      language: lang,
      ...result,
    }),
  };
}
