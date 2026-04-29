import type { ExecuteJobResult } from "../../../runtime/offeringTypes.js";

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || "";
const MODEL = "claude-sonnet-4-20250514";

interface JDAnalysisRequest {
  job_title: string;
  company?: string;
  description: string;
  language_hint?: string;
}

interface JDAnalysis {
  hard_skills: string[];
  soft_skills: string[];
  experience_years: string;
  education: string;
  language_required: string;
  remote_friendly: boolean;
  culture_keywords: string[];
  company_stage: string;
  role_family: string;
  seniority: string;
  key_points_to_emphasize: string[];
  potential_gaps_to_watch: string[];
  suggested_portfolio_themes: string[];
  tone: string;
}

const SYSTEM_PROMPT = `You are a job description analyst. Given a job posting, extract structured information.
Return ONLY valid JSON with these fields:
- hard_skills: array of technical/hard skills required
- soft_skills: array of soft skills mentioned or implied
- experience_years: string like "3-5 years" or "entry-level"
- education: string describing education requirements
- language_required: "en", "ko", "bilingual", or "any"
- remote_friendly: boolean
- culture_keywords: array of culture/values signals
- company_stage: "startup", "growth", "enterprise", or "unknown"
- role_family: one of "product_management", "engineering", "design", "data_science", "marketing", "operations", "strategy", "sales", "finance", "hr", "unknown"
- seniority: one of "intern", "junior", "mid", "senior", "lead", "director", "executive", "unknown"
- key_points_to_emphasize: array of candidate strengths to highlight for this role
- potential_gaps_to_watch: array of areas a candidate might need to address
- suggested_portfolio_themes: array of project themes that would impress for this role
- tone: "formal", "casual", "creative", or "corporate"`;

async function callAnthropic(prompt: string): Promise<string> {
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
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API error: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as {
    content: Array<{ type: string; text?: string }>;
  };
  return data.content?.[0]?.text || "";
}

function extractKeywords(text: string): JDAnalysis {
  const lower = text.toLowerCase();

  const skillPatterns: Record<string, string[]> = {
    hard_skills: ["python", "javascript", "typescript", "sql", "react", "node", "aws", "docker", "kubernetes", "figma", "tableau", "excel", "jira", "confluence", "git", "api", "rest", "graphql", "machine learning", "data analysis", "a/b testing", "agile", "scrum"],
    soft_skills: ["communication", "leadership", "teamwork", "problem solving", "analytical", "creative", "collaboration", "mentoring", "presentation", "negotiation", "stakeholder management"],
  };

  const hard_skills = skillPatterns.hard_skills.filter((s) => lower.includes(s));
  const soft_skills = skillPatterns.soft_skills.filter((s) => lower.includes(s));

  const seniorityMap: [string, string][] = [
    ["director", "director"],
    ["head of", "director"],
    ["vp ", "executive"],
    ["senior", "senior"],
    ["lead", "lead"],
    ["junior", "junior"],
    ["intern", "intern"],
    ["entry", "junior"],
  ];

  let seniority = "mid";
  for (const [keyword, level] of seniorityMap) {
    if (lower.includes(keyword)) {
      seniority = level;
      break;
    }
  }

  const hasKorean = /[\uAC00-\uD7AF]/.test(text);
  const language_required = hasKorean ? "ko" : "en";

  return {
    hard_skills: hard_skills.length > 0 ? hard_skills : ["general technical skills"],
    soft_skills: soft_skills.length > 0 ? soft_skills : ["communication", "teamwork"],
    experience_years: "not specified",
    education: "not specified",
    language_required,
    remote_friendly: lower.includes("remote") || lower.includes("재택"),
    culture_keywords: [],
    company_stage: "unknown",
    role_family: "unknown",
    seniority,
    key_points_to_emphasize: ["relevant experience", "domain expertise"],
    potential_gaps_to_watch: [],
    suggested_portfolio_themes: [],
    tone: "formal",
  };
}

export function validateRequirements(request: unknown): { valid: boolean; reason?: string } {
  const req = request as Record<string, unknown>;
  if (!req?.job_title || typeof req.job_title !== "string") {
    return { valid: false, reason: "job_title is required and must be a string" };
  }
  if (!req?.description || typeof req.description !== "string") {
    return { valid: false, reason: "description is required and must be a string" };
  }
  if (String(req.description).length < 50) {
    return { valid: false, reason: "description must be at least 50 characters" };
  }
  return { valid: true };
}

export function requestPayment(_request: Record<string, unknown>): string {
  return "JD analysis will be delivered as structured JSON with skills, seniority, role classification, and tailoring recommendations.";
}

export async function executeJob(request: Record<string, unknown>): Promise<ExecuteJobResult> {
  const req = request as unknown as JDAnalysisRequest;

  const prompt = [
    `Analyze this job posting:`,
    ``,
    `Job Title: ${req.job_title}`,
    req.company ? `Company: ${req.company}` : "",
    ``,
    `Job Description:`,
    req.description,
    ``,
    `Return the analysis as JSON.`,
  ]
    .filter(Boolean)
    .join("\n");

  let analysis: JDAnalysis;

  try {
    if (!ANTHROPIC_API_KEY) {
      throw new Error("No API key configured");
    }
    const raw = await callAnthropic(prompt);
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error("No JSON found in response");
    }
    analysis = JSON.parse(jsonMatch[0]) as JDAnalysis;
  } catch {
    analysis = extractKeywords(`${req.job_title} ${req.description}`);
  }

  return {
    deliverable: JSON.stringify({
      status: "success",
      job_title: req.job_title,
      company: req.company || "unknown",
      analysis,
    }),
  };
}
