export type ImportedExamQuestion = {
  number?: number;
  prompt: string;
  optionA: string;
  optionB: string;
  optionC: string;
  optionD: string;
  type: "single" | "multiple";
  answerIndexes: string[];
  explanation: string;
  warnings?: string[];
};

export function parseExamQuestionFile(text: string, filename?: string): ImportedExamQuestion[];
export function parseExamQuestionDocx(file: File): Promise<{ questions: ImportedExamQuestion[]; warnings: string[] }>;
export function splitExamQuestionGroups(questions: ImportedExamQuestion[], groupSize?: number): Array<{ index: number; title: string; productName: string; questions: ImportedExamQuestion[] }>;
export function examQuestionTemplate(): string;
