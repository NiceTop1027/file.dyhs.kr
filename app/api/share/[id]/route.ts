import { type NextRequest, NextResponse } from "next/server"
import { getFileById } from "@/lib/file-storage"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    console.log("[v0] Share API called with ID:", id)

    if (!id) {
      console.log("[v0] No ID provided")
      return NextResponse.json(
        { error: "파일 ID가 제공되지 않았습니다." },
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )
    }

    const file = await getFileById(id)
    console.log("[v0] File retrieved:", file)

    if (!file) {
      console.log("[v0] File not found")
      return NextResponse.json(
        { error: "파일을 찾을 수 없습니다." },
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )
    }

    const fileName = file.originalName || `file_${id}`
    const fileType = file.type || "application/octet-stream"

    console.log("[v0] File details:", {
      originalName: file.originalName,
      fileName: fileName,
      fileType: fileType,
      url: file.url,
    })

    try {
      const response = await fetch(file.url)
      if (!response.ok) {
        throw new Error("Failed to fetch file")
      }

      const fileBuffer = await response.arrayBuffer()
      console.log("[v0] File buffer size:", fileBuffer.byteLength)

      return new NextResponse(fileBuffer, {
        status: 200,
        headers: {
          "Content-Type": fileType,
          "Content-Disposition": `attachment; filename="${encodeURIComponent(fileName)}"`,
          "Content-Length": file.size.toString(),
          "Cache-Control": "no-cache, no-store, must-revalidate",
          Pragma: "no-cache",
          Expires: "0",
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      })
    } catch (fetchError) {
      console.error("[v0] Error fetching file:", fetchError)
      return NextResponse.json(
        { error: "파일 다운로드 중 오류가 발생했습니다." },
        {
          status: 500,
          headers: {
            "Content-Type": "application/json",
          },
        },
      )
    }
  } catch (error) {
    console.error("[v0] Share link error:", error)
    return NextResponse.json(
      { error: "서버 오류가 발생했습니다." },
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
        },
      },
    )
  }
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    },
  })
}
