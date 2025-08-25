import { type NextRequest, NextResponse } from "next/server"
import { getFileById } from "@/lib/file-storage"

export async function GET(request: NextRequest, { params }: { params: { id: string } }) {
  try {
    const fileId = params.id
    const file = await getFileById(fileId)

    if (!file) {
      return new NextResponse("File not found", { status: 404 })
    }

    // Fetch the file from Firebase Storage
    const response = await fetch(file.url)

    if (!response.ok) {
      return new NextResponse("Failed to fetch file", { status: 500 })
    }

    const blob = await response.blob()
    const downloadName = file.originalName || file.filename || file.id

    // Return the file with proper headers for download
    return new NextResponse(blob, {
      headers: {
        "Content-Type": file.type || "application/octet-stream",
        "Content-Disposition": `attachment; filename="${downloadName}"`,
        "Content-Length": blob.size.toString(),
      },
    })
  } catch (error) {
    console.error("Download error:", error)
    return new NextResponse("Internal server error", { status: 500 })
  }
}
