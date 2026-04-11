import { NextRequest, NextResponse } from "next/server";
import mammoth from "mammoth";

function extractPdfText(rawBytes: Uint8Array): string {
  // Lightweight best-effort extraction from text operators in PDF streams.
  // Keeps dependencies minimal; for scanned PDFs this may still return little text.
  const decoded = new TextDecoder("latin1").decode(rawBytes);
  const chunks = decoded.match(/\((?:\\.|[^\\()])*\)\s*Tj/g) || [];
  const values = chunks
    .map((chunk) => {
      const match = chunk.match(/\(([\s\S]*?)\)\s*Tj/);
      if (!match?.[1]) return "";
      return match[1]
        .replace(/\\n/g, " ")
        .replace(/\\r/g, " ")
        .replace(/\\t/g, " ")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
    })
    .filter(Boolean);
  return values.join(" ").replace(/\s+/g, " ").trim();
}

export async function POST(request: NextRequest) {
  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ message: "Файл не передан." }, { status: 400 });
  }

  const fileName = file.name.toLowerCase();
  const bytes = new Uint8Array(await file.arrayBuffer());
  let text = "";

  try {
    if (
      file.type.includes("wordprocessingml.document") ||
      fileName.endsWith(".docx")
    ) {
      const result = await mammoth.extractRawText({ buffer: Buffer.from(bytes) });
      text = result.value || "";
    } else if (file.type.startsWith("text/") || fileName.endsWith(".txt") || fileName.endsWith(".md")) {
      text = new TextDecoder("utf-8").decode(bytes);
    } else if (file.type === "application/pdf" || fileName.endsWith(".pdf")) {
      text = extractPdfText(bytes);
    } else {
      return NextResponse.json(
        { message: "Поддерживаются .pdf, .docx и текстовые файлы (.txt/.md)." },
        { status: 415 },
      );
    }
  } catch (error) {
    return NextResponse.json(
      {
        message: "Не удалось извлечь текст из файла.",
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 422 },
    );
  }

  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return NextResponse.json(
      { message: "Не удалось получить текст из файла. Попробуйте вставить текст вручную." },
      { status: 422 },
    );
  }

  return NextResponse.json({ text: normalized.slice(0, 20000) });
}
