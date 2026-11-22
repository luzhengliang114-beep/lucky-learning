import React from "react";
import { ArrowRight, Check, CheckCircle2, FileQuestion, RotateCcw, Sparkles, Trophy, XCircle } from "lucide-react";
import type { Question } from "@open-training/shared";
import { submitExam } from "../data";
import type { EmployeeAppData } from "../data";
import type { PageProps } from "../appTypes";
import { BeanBadge, EmptyState, PageHeader } from "../components";
import { applyExamResult } from "../quickActionStateCore.js";

type AppExam = EmployeeAppData["exams"][number];
type AnswerValue = number | number[];

export function ExamPage({ data, session, busy, navigate, notify, clearNotice, refresh, runAction }: PageProps) {
  const [product, setProduct] = React.useState("");
  const [exam, setExam] = React.useState<AppExam | null>(null);
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [answers, setAnswers] = React.useState<Record<string, AnswerValue>>({});
  const [result, setResult] = React.useState<{ score: number; passed: boolean; attemptsRemaining?: number; relearningRequired?: boolean } | null>(null);
  const [checkingExamId, setCheckingExamId] = React.useState("");
  const groups = groupExams(data.exams);
  const currentGroup = groups.find((group) => group.product === product);

  function enterExam(nextExam: AppExam) {
    setExam(nextExam);
    setQuestions(shuffle(nextExam.questions));
    setAnswers({});
    setResult(null);
  }

  async function openExam(nextExam: AppExam) {
    clearNotice();
    let currentExam = nextExam;
    const appearsLocked = currentExam.learningResetRequired || Number(currentExam.attemptsRemaining ?? 2) <= 0;
    if (appearsLocked && data.source !== "fallback") {
      setCheckingExamId(currentExam.id);
      try {
        const latest = await refresh({ fresh: true });
        currentExam = latest?.exams.find((item) => item.id === nextExam.id) || currentExam;
      } catch (error) {
        notify({ type: "error", text: error instanceof Error ? error.message : "考试状态核对失败，请稍后重试" });
        return;
      } finally {
        setCheckingExamId("");
      }
    }
    if (currentExam.learningResetRequired || Number(currentExam.attemptsRemaining ?? 2) <= 0) {
      notify({ type: "error", text: "请重新阅读资料、看完该产品视频，并逐项点击完成后恢复两次考试机会" });
      return;
    }
    enterExam(currentExam);
  }

  function back() {
    if (exam) {
      setExam(null);
      setResult(null);
      return;
    }
    if (product) {
      setProduct("");
      return;
    }
    navigate("home");
  }

  function choose(question: Question, optionIndex: number) {
    setAnswers((current) => {
      if (question.type !== "multiple") return { ...current, [question.id]: optionIndex };
      const existing = Array.isArray(current[question.id]) ? current[question.id] as number[] : [];
      const next = existing.includes(optionIndex) ? existing.filter((value) => value !== optionIndex) : [...existing, optionIndex];
      return { ...current, [question.id]: next };
    });
  }

  async function submit() {
    if (!exam || (!session && data.source !== "fallback")) return;
    const unanswered = questions.filter((question) => answers[question.id] === undefined || (Array.isArray(answers[question.id]) && (answers[question.id] as number[]).length === 0));
    if (unanswered.length) {
      notify({ type: "error", text: `还有 ${unanswered.length} 题未完成` });
      return;
    }
    const cloudAnswers = questions.map((question) => ({ questionId: question.id, value: answers[question.id] }));
    const demoResult = scoreExam(questions, answers, exam.passScore);
    const actionResult = await runAction(`exam-${exam.id}`, () => submitExam(session!, exam.id, cloudAnswers), {
      demoAction: { type: "submitExam", payload: { examId: exam.id, score: demoResult.score, passed: demoResult.passed } },
      refreshMode: "background",
      applyResult: (current, result) => applyExamResult(current, exam.id, result.data)
    });
    if (!actionResult) return;
    const payload = actionResult.data || demoResult;
    const passed = Boolean(payload.passed ?? demoResult.passed);
    const attemptsRemaining = Number(payload.attemptsRemaining ?? Math.max(0, Number(exam.attemptsRemaining ?? 2) - 1));
    const nextResult = { score: Number(payload.score ?? demoResult.score), passed, attemptsRemaining, relearningRequired: Boolean(payload.relearningRequired ?? (!passed && attemptsRemaining <= 0)) };
    setResult(nextResult);
    setExam((current) => current ? { ...current, attemptsRemaining: nextResult.attemptsRemaining, attemptCount: Number(current.attemptCount || 0) + 1, learningResetRequired: nextResult.relearningRequired, completed: nextResult.passed ? true : current.completed } : current);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (exam) {
    return (
      <div>
        <PageHeader title={exam.title} subtitle={`${questions.length} 题 · ${exam.passScore} 分通过 · 剩余 ${exam.attemptsRemaining ?? 2} 次`} onBack={back} action={<BeanBadge value={data.employee.goldenBeans} />} />
        {result ? <ExamResult result={result} reward={exam.goldenBeans} onDone={() => setExam(null)} onRetry={() => { clearNotice(); setAnswers({}); setResult(null); }} onRelearn={() => navigate("learning")} /> : (
          <div className="exam-sheet">
            <div className="exam-progress"><span style={{ width: `${questions.length ? Object.keys(answers).length / questions.length * 100 : 0}%` }} /><small>{Object.keys(answers).length}/{questions.length}</small></div>
            {questions.map((question, questionIndex) => (
              <section className="question-block" key={question.id}>
                <div className="question-title"><span>{String(questionIndex + 1).padStart(2, "0")}</span><h2>{question.prompt}</h2>{question.type === "multiple" ? <i>多选</i> : null}</div>
                <div className="answer-options">
                  {question.options.map((option, optionIndex) => {
                    const answer = answers[question.id];
                    const selected = Array.isArray(answer) ? answer.includes(optionIndex) : answer === optionIndex;
                    return <button className={selected ? "selected" : ""} type="button" key={option} onClick={() => choose(question, optionIndex)}><span>{String.fromCharCode(65 + optionIndex)}</span><b>{option}</b>{selected ? <Check size={17} /> : null}</button>;
                  })}
                </div>
              </section>
            ))}
            <button className="primary-button full-button exam-submit" type="button" disabled={busy === `exam-${exam.id}`} onClick={submit}>{busy === `exam-${exam.id}` ? "正在交卷" : "提交答卷"}</button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <PageHeader title={currentGroup ? currentGroup.product : "产品测评"} subtitle={currentGroup ? `${currentGroup.exams.length} 项测评` : "按产品进入测评题库，检验掌握情况"} onBack={back} action={<BeanBadge value={data.employee.goldenBeans} />} />
      {!currentGroup ? (
        groups.length ? <div className="exam-collections">{groups.map((group, index) => (
          <button type="button" key={group.product} onClick={() => setProduct(group.product)}>
            <span className={`exam-collection-icon exam-tone-${index % 3}`}><FileQuestion size={27} /></span>
            <span><strong>{group.product}</strong><small>{examTaskText(group.taskStatus)} · {group.exams.length} 项测评 · {group.completed} 项已通过</small></span>
            <ArrowRight size={19} />
          </button>
        ))}</div> : <EmptyState title="暂无测评" text="后台发布产品测评后会显示在这里" />
      ) : <div className="exam-list">{currentGroup.exams.map((item, index) => (
        <button type="button" key={item.id} disabled={checkingExamId === item.id} onClick={() => openExam(item)}>
          <span className="paper-number">{String(index + 1).padStart(2, "0")}</span>
          <span><strong>{item.title}</strong><small>{item.questions.length} 题 · {item.passScore} 分通过 · {item.goldenBeans} 金豆</small></span>
          {checkingExamId === item.id ? <small>正在核对</small> : item.completed ? <CheckCircle2 className="passed-icon" size={21} /> : item.learningResetRequired ? <small>需重学资料</small> : Number(item.attemptsRemaining ?? 2) <= 0 ? <small>需重学资料</small> : <ArrowRight size={19} />}
        </button>
      ))}</div>}
    </div>
  );
}

function ExamResult({ result, reward, onDone, onRetry, onRelearn }: { result: { score: number; passed: boolean; attemptsRemaining?: number; relearningRequired?: boolean }; reward: number; onDone: () => void; onRetry: () => void; onRelearn: () => void }) {
  const canRetry = !result.passed && !result.relearningRequired && Number(result.attemptsRemaining || 0) > 0;
  return (
    <section className={`exam-result ${result.passed ? "passed" : "failed"}`}>
      <span className="result-icon">{result.passed ? <Trophy size={34} /> : <XCircle size={34} />}</span>
      <p>{result.passed ? "答题通过" : "还差一点"}</p>
      <strong>{result.score}<small>分</small></strong>
      <div>{result.passed ? <><Sparkles size={17} />通过奖励 {reward} 金豆</> : canRetry ? `还可考试 ${result.attemptsRemaining} 次` : "请重新阅读资料、看完该产品视频，并逐项点击完成后恢复两次考试机会"}</div>
      <button className="primary-button full-button" type="button" onClick={result.passed ? onDone : canRetry ? onRetry : onRelearn}>{result.passed ? "返回测评列表" : canRetry ? "再考一次" : "返回重新学习"}</button>
    </section>
  );
}

function groupExams(exams: AppExam[]) {
  const map = new Map<string, { exams: AppExam[]; taskStatus?: AppExam["taskStatus"] }>();
  exams.forEach((exam) => {
    const product = exam.productName || "综合知识";
    const group = map.get(product) || { exams: [], taskStatus: exam.taskStatus };
    group.exams.push(exam);
    map.set(product, group);
  });
  return [...map.entries()].map(([product, group]) => ({ product, taskStatus: group.taskStatus, exams: group.exams.sort((a, b) => Number(a.sortOrder || 0) - Number(b.sortOrder || 0)), completed: group.exams.filter((exam) => exam.completed).length }));
}

function examTaskText(status: AppExam["taskStatus"]) {
  return status === "completed" ? "任务已完成，考试不强制" : status === "learning-required" ? "完成学习后需考试" : "需考试";
}

function shuffle<T>(items: T[]) {
  const next = [...items];
  for (let index = next.length - 1; index > 0; index -= 1) {
    const target = Math.floor(Math.random() * (index + 1));
    [next[index], next[target]] = [next[target], next[index]];
  }
  return next;
}

function scoreExam(questions: Question[], answers: Record<string, AnswerValue>, passScore: number) {
  const correct = questions.filter((question) => {
    const answer = answers[question.id];
    if (question.type === "multiple") {
      const expected = [...(question.answerIndexes || [])].sort().join(",");
      const actual = [...(Array.isArray(answer) ? answer : [answer])].sort().join(",");
      return Boolean(expected) && expected === actual;
    }
    return Number(answer) === Number(question.answerIndex);
  }).length;
  const score = questions.length ? Math.round(correct / questions.length * 100) : 0;
  return { score, passed: score >= passScore };
}
