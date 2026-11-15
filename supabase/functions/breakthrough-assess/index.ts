import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { RUBRICS } from "../_shared/breakthrough-rubrics.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: cors });
const enc = new TextEncoder();
async function hash(value: string) {
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(value));
  return [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
}
function validCode(v: unknown) { return typeof v === "string" && /^[A-HJ-NP-Z2-9]{8}$/.test(v); }
function validToken(v: unknown) { return typeof v === "string" && /^[a-f0-9]{64}$/i.test(v); }
function safeText(v: unknown, max = 8000) { return typeof v === "string" ? v.trim().slice(0, max) : ""; }

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const url = Deno.env.get("SUPABASE_URL"), serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !serviceKey) return json({ error: "Thiếu cấu hình máy chủ Supabase." }, 503);
  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  let body: Record<string, unknown>;
  try { body = await req.json(); } catch { return json({ error: "Dữ liệu gửi lên không hợp lệ." }, 400); }
  const action = safeText(body.action, 32), roomCode = safeText(body.roomCode, 8), teacherToken = safeText(body.teacherToken, 64);
  if (!validCode(roomCode) || !validToken(teacherToken)) return json({ error: "Mã phòng hoặc mã xác thực không hợp lệ." }, 400);

  if (action === "register-room") {
    const { error } = await db.from("breakthrough_rooms").insert({ room_code: roomCode, teacher_token_hash: await hash(teacherToken) });
    if (error) return json({ error: error.code === "23505" ? "Mã phòng đã tồn tại. Hãy tạo phòng mới." : "Không thể đăng ký phòng." }, 409);
    return json({ ok: true });
  }
  const { data: room, error: roomError } = await db.from("breakthrough_rooms").select("*").eq("room_code", roomCode).maybeSingle();
  if (roomError || !room || room.teacher_token_hash !== await hash(teacherToken)) return json({ error: "Không xác thực được quyền của phòng." }, 403);

  if (action === "sync-round") {
    const assigned = body.assigned && typeof body.assigned === "object" ? body.assigned as Record<string, number> : {};
    const closesAt = typeof body.closesAt === "string" ? body.closesAt : null;
    const { error } = await db.from("breakthrough_rooms").update({ assigned, closes_at: closesAt }).eq("room_code", roomCode);
    return error ? json({ error: "Không thể cập nhật trạng thái vòng." }, 500) : json({ ok: true });
  }
  if (action === "sync-captains") {
    const captains = body.captains && typeof body.captains === "object" ? body.captains as Record<string, string> : {};
    const { error } = await db.from("breakthrough_rooms").update({ captains }).eq("room_code", roomCode);
    return error ? json({ error: "Không thể đồng bộ đội trưởng." }, 500) : json({ ok: true });
  }
  if (action === "submit") {
    const team = Number(body.teamIndex), scenario = Number(body.scenarioIndex), captain = safeText(body.captainPeer, 128), answer = safeText(body.answer);
    if (!Number.isInteger(team) || team < 0 || team > 3 || !Number.isInteger(scenario) || scenario < 0 || scenario > 7 || answer.length < 10) return json({ error: "Bài làm cần có nội dung rõ ràng trước khi gửi." }, 400);
    if (String(room.captains?.[team] || "") !== captain || Number(room.assigned?.[team]) !== scenario) return json({ error: "Không xác thực được đội trưởng hoặc tình huống của đội." }, 403);
    if (!room.closes_at || Date.now() > new Date(room.closes_at).getTime()) return json({ error: "Đã hết thời gian gửi bài." }, 409);
    const rubric = RUBRICS.find(x => x.scenario === scenario + 1);
    if (!rubric) return json({ error: "Không tìm thấy barem cho tình huống." }, 400);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    if (!apiKey) return json({ error: "Máy chủ chưa được cấu hình dịch vụ AI. Bài làm chưa bị mất; vui lòng báo giáo viên." }, 503);
    const confirmed = await db.from("breakthrough_submissions").select("id").eq("room_code", roomCode).eq("team_index", team).eq("status", "confirmed").limit(1).maybeSingle();
    if (confirmed.data) return json({ error: "Giáo viên đã xác nhận điểm cho đội. Bài làm đã được chốt." }, 409);\n    const latest = await db.from("breakthrough_submissions").select("version").eq("room_code", roomCode).eq("team_index", team).order("version", { ascending: false }).limit(1).maybeSingle();
    const version = (latest.data?.version || 0) + 1;
    const prompt = [
      "Bạn là trợ lý đánh giá học tập cho học sinh THCS. Đánh giá bài làm của MỘT ĐỘI theo đúng barem JSON được cung cấp.",
      "Nguyên tắc: không chê bai, không gắn nhãn học sinh; công nhận điều đúng; chỉ rõ điều thiếu/sai; giải thích ngắn; đặt câu hỏi gợi mở để đội tự sửa. Chấp nhận cách diễn đạt khác nếu đúng bản chất. Không yêu cầu kiến thức vượt THCS.",
      "Chỉ chấm dựa trên câu trả lời và barem. Không suy đoán ý học sinh. Mỗi nhận xét phải có bằng chứng trích nguyên văn từ câu trả lời; nếu không có bằng chứng thì evidence là chuỗi rỗng. Không tự thêm tiêu chí. Không tính tổng điểm.",
      "Trả về DUY NHẤT JSON object: {criteria:[{id,score,evidence,status,issue,explanation,question,suggestion}],overall_message,needs_teacher_review}. status là achieved|partial|revise. score là số nguyên từ 0 đến max của tiêu chí. Đánh dấu needs_teacher_review=true nếu có nội dung chuyên môn mơ hồ, mâu thuẫn hoặc không đủ căn cứ để đánh giá.",
      "Barem: " + JSON.stringify(rubric),
      "Bài làm của đội: " + answer
    ].join("\n\n");
    let aiData: any;
    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", { method: "POST", headers: { "Authorization": "Bearer " + apiKey, "Content-Type": "application/json" }, body: JSON.stringify({ model: Deno.env.get("OPENAI_MODEL") || "gpt-4.1-mini", temperature: 0.1, response_format: { type: "json_object" }, messages: [{ role: "system", content: "Đánh giá chính xác, thận trọng và khích lệ. Chỉ trả JSON." }, { role: "user", content: prompt }] }) });
      if (!response.ok) return json({ error: "Dịch vụ AI chưa phản hồi thành công. Bài làm được giữ để thử lại." }, 502);
      const payload = await response.json();
      aiData = JSON.parse(payload.choices?.[0]?.message?.content || "{}");
    } catch { return json({ error: "Không thể phân tích bài làm lúc này. Nội dung chưa bị mất." }, 502); }
    const returned = Array.isArray(aiData.criteria) ? aiData.criteria : [];
    const criteria = rubric.criteria.map((c) => {
      const item = returned.find((x: any) => x.id === c.id) || {};
      const score = Number.isFinite(item.score) ? Math.max(0, Math.min(c.max, Math.round(item.score))) : 0;
      const evidence = safeText(item.evidence, 500);
      return { id: c.id, label: c.label, max: c.max, score, evidence: evidence && answer.includes(evidence) ? evidence : "", status: ["achieved", "partial", "revise"].includes(item.status) ? item.status : "revise", issue: safeText(item.issue, 500), explanation: safeText(item.explanation, 700), question: safeText(item.question, 400), suggestion: safeText(item.suggestion, 500) };
    });
    const total = criteria.reduce((sum, item) => sum + item.score, 0);
    const needsReview = !!aiData.needs_teacher_review || returned.length !== rubric.criteria.length || criteria.some(x => x.evidence === "" && x.score > 0);
    const record = { room_code: roomCode, team_index: team, scenario_index: scenario, version, captain_peer: captain, answer, criteria, total_score: total, feedback: { overall_message: safeText(aiData.overall_message, 1000), needs_teacher_review: needsReview }, status: needsReview ? "manual_review" : "assessed" };
    const { data: saved, error: saveError } = await db.from("breakthrough_submissions").insert(record).select("id,team_index,scenario_index,version,answer,criteria,total_score,feedback,status,created_at").single();
    if (saveError) return json({ error: "Không lưu được kết quả đánh giá. Bài làm vẫn có thể gửi lại." }, 500);
    return json({ result: saved });
  }
  if (action === "results") {
    const { data, error } = await db.from("breakthrough_submissions").select("id,team_index,scenario_index,version,answer,criteria,total_score,feedback,status,teacher_score,teacher_note,created_at").eq("room_code", roomCode).order("team_index").order("version", { ascending: false });
    return error ? json({ error: "Không tải được kết quả." }, 500) : json({ results: data || [] });
  }
  if (action === "confirm") {
    const id = safeText(body.submissionId, 64), score = Number(body.teacherScore), note = safeText(body.teacherNote, 1000);
    if (!id || !Number.isInteger(score) || score < 0 || score > 100) return json({ error: "Điểm xác nhận phải từ 0 đến 100." }, 400);
    const { data, error } = await db.from("breakthrough_submissions").update({ teacher_score: score, teacher_note: note, status: "confirmed" }).eq("id", id).eq("room_code", roomCode).select("id,teacher_score,status").single();
    return error ? json({ error: "Không thể xác nhận điểm." }, 500) : json({ result: data });
  }
  return json({ error: "Tác vụ không được hỗ trợ." }, 400);
});
