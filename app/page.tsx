"use client"

import type React from "react"
import { useState, useEffect } from "react"
import {
  Upload,
  FileText,
  Download,
  Copy,
  Check,
  Clock,
  Trash2,
  Settings,
  BarChart3,
  Shield,
  Zap,
  ChevronRight,
  Menu,
  X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { useToast } from "@/hooks/use-toast"
import { useRouter } from "next/navigation"
import { storage } from "@/lib/firebase/config"
import { ref, uploadBytes, getDownloadURL } from "firebase/storage"
import {
  type FileMetadata,
  saveFileMetadata,
  getStoredFiles,
  startAutoCleanup,
  deleteFileMetadata,
  getUserSessionId,
  getTimeUntilExpiry,
  formatExpiryTime,
  getSecuritySettings,
  updateSecuritySettings,
  getUploadStatistics,
  checkRateLimit,
  updateDownloadCount,
  generateFileId,
} from "@/lib/file-storage"
import Image from "next/image"

type BulkUploadProgress = {
  total: number
  completed: number
  failed: number
  currentFile: string
}

type UploadStatistics = {
  totalUploads: number
  uploadsToday: number
  totalSize: number
  averageFileSize: number
  mostUploadedType: string
}

export default function HomePage() {
  const router = useRouter()
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadedFiles, setUploadedFiles] = useState<FileMetadata[]>([])
  const [copiedFileId, setCopiedFileId] = useState<string | null>(null)
  const [autoDeleteMinutes, setAutoDeleteMinutes] = useState(5)
  const [currentTime, setCurrentTime] = useState(Date.now())
  const [leftDropdownOpen, setLeftDropdownOpen] = useState(false)
  const [rightDropdownOpen, setRightDropdownOpen] = useState(false)
  const [securityMode, setSecurityMode] = useState(false)
  const [bulkUploadMode, setBulkUploadMode] = useState(false)
  const [uploadProgress, setUploadProgress] = useState<BulkUploadProgress | null>(null)
  const [uploadStats, setUploadStats] = useState<UploadStatistics | null>(null)
  const [showStatsModal, setShowStatsModal] = useState(false)
  const { toast } = useToast()

  const loadFiles = async () => {
    try {
      const files = await getStoredFiles()
      setUploadedFiles(Array.isArray(files) ? files : [])
    } catch (error) {
      console.error("Failed to load files:", error)
      setUploadedFiles([])
    }
  }

  useEffect(() => {
    loadFiles()

    const savedDeleteTime = localStorage.getItem("autoDeleteMinutes")
    if (savedDeleteTime) {
      setAutoDeleteMinutes(Number.parseInt(savedDeleteTime))
    }

    startAutoCleanup(1, 5) // Check every 1 minute, delete after 5 minutes

    const settings = getSecuritySettings()
    setSecurityMode(settings.encryptionEnabled)
    setUploadStats(getUploadStatistics())
  }, [])

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now())
      // loadFiles() 제거 - 무한 루프 방지
    }, 1000)

    return () => clearInterval(timer)
  }, [])

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const files = Array.from(e.dataTransfer.files)
    const items = Array.from(e.dataTransfer.items)

    const allFiles: File[] = []

    const processItems = async () => {
      for (const item of items) {
        if (item.kind === "file") {
          const entry = item.webkitGetAsEntry()
          if (entry) {
            await processEntry(entry, allFiles)
          }
        }
      }

      if (allFiles.length > 0) {
        uploadFiles(allFiles)
      } else if (files.length > 0) {
        uploadFiles(files)
      }
    }

    processItems()
  }

  const processEntry = async (entry: any, files: File[]): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) => {
        entry.file((file: File) => resolve(file))
      })
      files.push(file)
    } else if (entry.isDirectory) {
      const reader = entry.createReader()
      const entries = await new Promise<any[]>((resolve) => {
        reader.readEntries((entries: any[]) => resolve(entries))
      })

      for (const childEntry of entries) {
        await processEntry(childEntry, files)
      }
    }
  }

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || [])
    if (files.length > 0) {
      uploadFiles(files)
    }
  }

  const uploadFiles = async (files: File[]) => {
    console.log("[v0] uploadFiles called with", files.length, "files")
    setIsUploading(true)
    const settings = getSecuritySettings()

    // Check rate limit
    const rateLimitCheck = checkRateLimit()
    if (!rateLimitCheck.allowed) {
      console.log("[v0] Rate limit exceeded")
      toast({
        title: "업로드 제한",
        description: "잠시 후 다시 시도해주세요.",
        variant: "destructive",
      })
      setIsUploading(false)
      return
    }

    // Initialize bulk upload progress
    if (files.length > 1) {
      setBulkUploadMode(true)
      setUploadProgress({
        total: files.length,
        completed: 0,
        failed: 0,
        currentFile: files[0].name,
      })
    }

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i]
        console.log("[v0] Processing file:", file.name, "size:", file.size)

        // Update progress
        if (bulkUploadMode && uploadProgress) {
          setUploadProgress((prev) =>
            prev
              ? {
                  ...prev,
                  currentFile: file.name,
                }
              : null,
          )
        }

        try {
          const fileId = generateFileId()
          const fileName = `${fileId}.${file.name.split(".").pop() || "bin"}`
          const storageRef = ref(storage, `files/${fileName}`)

          console.log("[v0] Uploading to Firebase Storage:", fileName)
          const snapshot = await uploadBytes(storageRef, file)
          const downloadURL = await getDownloadURL(snapshot.ref)

          console.log("[v0] File uploaded successfully. Download URL:", downloadURL)

          const fileMetadata: FileMetadata = {
            id: fileId,
            filename: fileName,
            originalName: file.name,
            size: file.size,
            type: file.type,
            url: downloadURL,
            uploadedAt: new Date().toISOString(),
            downloadCount: 0,
            userId: getUserSessionId(),
            expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(), // Set expiry time to 5 minutes from now
          }

          console.log("[v0] Saving file metadata:", fileMetadata)
          await saveFileMetadata(fileMetadata)
          await loadFiles()

          // Update progress
          if (uploadProgress) {
            setUploadProgress((prev) =>
              prev
                ? {
                    ...prev,
                    completed: prev.completed + 1,
                  }
                : null,
            )
          }

          toast({
            title: "파일 업로드 성공",
            description: `${file.name}이 성공적으로 업로드되었습니다.`,
          })
        } catch (uploadError) {
          console.error("[v0] Firebase Storage upload error:", uploadError)

          // Update failed count
          if (uploadProgress) {
            setUploadProgress((prev) =>
              prev
                ? {
                    ...prev,
                    failed: prev.failed + 1,
                  }
                : null,
            )
          }

          throw uploadError
        }
      }

      // Update statistics
      setUploadStats(getUploadStatistics())
    } catch (error) {
      console.error("[v0] Upload error:", error)
      toast({
        title: "업로드 실패",
        description: `파일 업로드 중 오류가 발생했습니다: ${error instanceof Error ? error.message : String(error)}`,
        variant: "destructive",
      })
    } finally {
      setIsUploading(false)
      setBulkUploadMode(false)
      setUploadProgress(null)
      await loadFiles()
    }
  }

  const deleteFile = async (fileId: string, filename: string) => {
    try {
      const success = await deleteFileMetadata(fileId)

      if (success) {
        await loadFiles()
        toast({
          title: "파일 삭제됨",
          description: `${filename}이 삭제되었습니다.`,
        })
      } else {
        toast({
          title: "삭제 실패",
          description: "파일을 삭제할 권한이 없습니다.",
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "삭제 실패",
        description: "파일 삭제 중 오류가 발생했습니다.",
        variant: "destructive",
      })
    }
  }

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return "0 Bytes"
    const k = 1024
    const sizes = ["Bytes", "KB", "MB", "GB"]
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
  }

  const downloadFile = async (file: FileMetadata) => {
    try {
      const response = await fetch(file.url)
      const blob = await response.blob()

      const url = window.URL.createObjectURL(blob)
      const link = document.createElement("a")
      link.href = url
      link.download = file.originalName
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      window.URL.revokeObjectURL(url)

      await updateDownloadCount(file.id)
      toast({
        title: "다운로드 시작",
        description: `${file.originalName} 다운로드가 시작되었습니다.`,
      })
    } catch (error) {
      toast({
        title: "다운로드 실패",
        description: "파일 다운로드 중 오류가 발생했습니다.",
        variant: "destructive",
      })
    }
  }

  const copyShareLink = async (fileId: string, filename: string) => {
    try {
      const shareUrl = `https://file.dyhs.kr/${fileId}`
      await navigator.clipboard.writeText(shareUrl)

      setCopiedFileId(fileId)
      setTimeout(() => setCopiedFileId(null), 2000)

      toast({
        title: "공유 링크 복사됨",
        description: `${filename}의 공유 링크가 클립보드에 복사되었습니다.`,
      })
    } catch (error) {
      const textArea = document.createElement("textarea")
      textArea.value = `https://file.dyhs.kr/${fileId}`
      document.body.appendChild(textArea)
      textArea.select()
      document.execCommand("copy")
      document.body.removeChild(textArea)

      setCopiedFileId(fileId)
      setTimeout(() => setCopiedFileId(null), 2000)

      toast({
        title: "공유 링크 복사됨",
        description: `${filename}의 공유 링크가 클립보드에 복사되었습니다.`,
      })
    }
  }

  const handleShowStatistics = () => {
    setShowStatsModal(true)
    setUploadStats(getUploadStatistics())
    toast({
      title: "업로드 통계",
      description: "상세한 업로드 통계를 확인하세요.",
    })
  }

  const handleToggleBulkUpload = () => {
    setBulkUploadMode(!bulkUploadMode)
    toast({
      title: bulkUploadMode ? "일괄 업로드 비활성화" : "일괄 업로드 활성화",
      description: bulkUploadMode
        ? "단일 파일 업로드 모드로 전환되었습니다."
        : "여러 파일을 동시에 업로드할 수 있습니다.",
    })
  }

  return (
    <div className="min-h-screen bg-background">
      {showStatsModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-2xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-bold text-foreground">업로드 통계</h3>
              <button
                onClick={() => setShowStatsModal(false)}
                className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            {uploadStats && (
              <div className="space-y-4">
                <div className="flex justify-between items-center p-3 bg-blue-50 rounded-lg">
                  <span className="text-sm font-medium">총 업로드</span>
                  <span className="font-bold text-blue-600">{uploadStats.totalUploads}개</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-green-50 rounded-lg">
                  <span className="text-sm font-medium">오늘 업로드</span>
                  <span className="font-bold text-green-600">{uploadStats.uploadsToday}개</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-purple-50 rounded-lg">
                  <span className="text-sm font-medium">총 용량</span>
                  <span className="font-bold text-purple-600">{formatFileSize(uploadStats.totalSize)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-orange-50 rounded-lg">
                  <span className="text-sm font-medium">평균 크기</span>
                  <span className="font-bold text-orange-600">{formatFileSize(uploadStats.averageFileSize)}</span>
                </div>
                <div className="flex justify-between items-center p-3 bg-indigo-50 rounded-lg">
                  <span className="text-sm font-medium">주요 형식</span>
                  <span className="font-bold text-indigo-600">{uploadStats.mostUploadedType}</span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className={`side-dropdown left ${leftDropdownOpen ? "open" : ""}`}>
        <div className="dropdown-content">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground">시스템 설정</h3>
            <button
              onClick={() => setLeftDropdownOpen(false)}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="dropdown-section">
            <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Settings className="h-4 w-4 text-primary" />
              파일 관리
            </h4>
            <div className="space-y-2">
              <div className="feature-item">
                <Clock className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium">자동 삭제 시간</p>
                  <input
                    type="range"
                    min="1"
                    max="60"
                    value={autoDeleteMinutes}
                    onChange={(e) => setAutoDeleteMinutes(Number(e.target.value))}
                    className="w-full mt-1"
                  />
                  <p className="text-xs text-muted-foreground">{autoDeleteMinutes}분 후 삭제</p>
                </div>
              </div>
            </div>
          </div>

          {/* Enhanced left dropdown with security features */}
          <div className="dropdown-section">
            <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Shield className="h-4 w-4 text-primary" />
              보안 설정
            </h4>
            <div className="space-y-2">
              <div className="feature-item">
                <Shield className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium">보안 모드</p>
                  <p className="text-xs text-muted-foreground">파일 암호화 및 검증</p>
                </div>
                <button
                  onClick={() => {
                    setSecurityMode(!securityMode)
                    updateSecuritySettings({ encryptionEnabled: !securityMode })
                  }}
                  className={`w-12 h-6 rounded-full transition-colors ${securityMode ? "bg-primary" : "bg-gray-300"}`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      securityMode ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
              <div className="feature-item">
                <Upload className="h-4 w-4 text-primary" />
                <div className="flex-1">
                  <p className="text-sm font-medium">일괄 업로드</p>
                  <p className="text-xs text-muted-foreground">여러 파일 동시 처리</p>
                </div>
                <button
                  onClick={handleToggleBulkUpload}
                  className={`w-12 h-6 rounded-full transition-colors ${bulkUploadMode ? "bg-primary" : "bg-gray-300"}`}
                >
                  <div
                    className={`w-5 h-5 bg-white rounded-full transition-transform ${
                      bulkUploadMode ? "translate-x-6" : "translate-x-1"
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="dropdown-section">
            <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4 text-primary" />
              고급 기능
            </h4>
            <div className="space-y-2">
              <button
                onClick={handleShowStatistics}
                className="feature-item w-full text-left hover:bg-blue-50 transition-colors rounded-lg p-2"
              >
                <BarChart3 className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">업로드 통계</p>
                  <p className="text-xs text-muted-foreground">파일 업로드 분석</p>
                </div>
                <ChevronRight className="h-4 w-4 ml-auto" />
              </button>
              <button
                onClick={handleToggleBulkUpload}
                className="feature-item w-full text-left hover:bg-blue-50 transition-colors rounded-lg p-2"
              >
                <Upload className="h-4 w-4 text-primary" />
                <div>
                  <p className="text-sm font-medium">일괄 업로드</p>
                  <p className="text-xs text-muted-foreground">여러 파일 동시 처리</p>
                </div>
                <div
                  className={`w-6 h-3 rounded-full transition-colors ml-auto ${bulkUploadMode ? "bg-primary" : "bg-gray-300"}`}
                >
                  <div
                    className={`w-3 h-3 bg-white rounded-full transition-transform ${
                      bulkUploadMode ? "translate-x-3" : "translate-x-0"
                    }`}
                  />
                </div>
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className={`side-dropdown right ${rightDropdownOpen ? "open" : ""}`}>
        <div className="dropdown-content">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-foreground">파일 정보</h3>
            <button
              onClick={() => setRightDropdownOpen(false)}
              className="p-2 hover:bg-accent rounded-lg transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Enhanced right dropdown with detailed statistics */}
          <div className="dropdown-section">
            <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              상세 통계
            </h4>
            {uploadStats && (
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">총 업로드</span>
                  <span className="font-bold text-primary">{uploadStats.totalUploads}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">오늘 업로드</span>
                  <span className="font-bold text-green-500">{uploadStats.uploadsToday}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">총 용량</span>
                  <span className="font-bold text-blue-500">{formatFileSize(uploadStats.totalSize)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">평균 크기</span>
                  <span className="font-bold text-purple-500">{formatFileSize(uploadStats.averageFileSize)}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">주요 형식</span>
                  <span className="font-bold text-orange-500">{uploadStats.mostUploadedType}</span>
                </div>
              </div>
            )}
          </div>

          <div className="dropdown-section">
            <h4 className="font-semibold text-foreground mb-3 flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              최근 파일
            </h4>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {Array.isArray(uploadedFiles) &&
                uploadedFiles.slice(0, 5).map((file, index) => (
                  <div key={index} className="feature-item">
                    <FileText className="h-4 w-4 text-primary flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{file.originalName}</p>
                      <p className="text-xs text-muted-foreground">{formatFileSize(file.size)}</p>
                    </div>
                  </div>
                ))}
              {uploadedFiles.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">업로드된 파일이 없습니다</p>
              )}
            </div>
          </div>
        </div>
      </div>

      <button className="dropdown-trigger left" onClick={() => setLeftDropdownOpen(!leftDropdownOpen)}>
        <Menu className="h-5 w-5" />
      </button>

      <button className="dropdown-trigger right" onClick={() => setRightDropdownOpen(!rightDropdownOpen)}>
        <BarChart3 className="h-5 w-5" />
      </button>

      <header className="border-b border-border bg-gradient-to-r from-white to-blue-50/30">
        <div className="container mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <div className="relative">
                <Image
                  src="/deokyoung-logo.png"
                  alt="덕영고등학교 로고"
                  width={48}
                  height={48}
                  className="rounded-full animate-gentle-float"
                />
              </div>
              <div>
                <h1 className="text-xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent">
                  Dyhs File
                </h1>
                <p className="text-sm text-muted-foreground">file.dyhs.kr</p>
              </div>
            </div>
            <div className="flex items-center gap-4">
              <div className="stats-card">
                <Clock className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">{autoDeleteMinutes}분 후 삭제</span>
              </div>
            </div>
          </div>
        </div>
      </header>

      <div className="container mx-auto px-4 py-12">
        <div className="text-center mb-12">
          <div className="max-w-md mx-auto mb-8">
            <div className="pill-container p-4">
              <div className="flex items-center gap-3 text-muted-foreground">
                <div className="w-3 h-3 bg-green-500 rounded-full"></div>
                <span className="font-mono text-lg">file.dyhs.kr/abcd</span>
              </div>
            </div>
          </div>
          <h2 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-blue-800 bg-clip-text text-transparent mb-4">
            파일을 업로드하고 공유하세요
          </h2>
          <p className="text-muted-foreground text-lg">간단하고 빠른 파일 공유 서비스</p>
          <div className="flex flex-wrap justify-center gap-4 mt-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full"></div>
              <span>최대 1GB 파일 지원</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-green-500 rounded-full"></div>
              <span>자동 삭제로 안전한 공유</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 bg-purple-500 rounded-full"></div>
              <span>모든 파일 형식 및 폴더 지원</span>
            </div>
          </div>
        </div>

        {/* Bulk upload progress indicator */}
        {uploadProgress && (
          <div className="max-w-2xl mx-auto mb-6">
            <div className="bg-white rounded-2xl p-6 shadow-lg border border-blue-100">
              <div className="flex items-center justify-between mb-4">
                <h4 className="font-semibold text-foreground">일괄 업로드 진행중</h4>
                <span className="text-sm text-muted-foreground">
                  {uploadProgress.completed + uploadProgress.failed} / {uploadProgress.total}
                </span>
              </div>
              <div className="w-full bg-gray-200 rounded-full h-2 mb-4">
                <div
                  className="bg-primary h-2 rounded-full transition-all duration-300"
                  style={{
                    width: `${((uploadProgress.completed + uploadProgress.failed) / uploadProgress.total) * 100}%`,
                  }}
                />
              </div>
              <p className="text-sm text-muted-foreground">현재: {uploadProgress.currentFile}</p>
              {uploadProgress.failed > 0 && (
                <p className="text-sm text-destructive mt-2">실패: {uploadProgress.failed}개 파일</p>
              )}
            </div>
          </div>
        )}

        <div className="max-w-2xl mx-auto mb-12">
          <div
            className={`upload-area transition-all duration-300 ${isDragging ? "scale-105" : ""}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="p-16 text-center text-white relative z-10">
              <div className="mb-6">
                <Upload className="h-16 w-16 mx-auto mb-4 opacity-90" />
                <h3 className="text-2xl font-bold mb-2">파일이나 폴더를 드롭하세요</h3>
                <p className="text-lg opacity-90">또는 클릭하여 파일을 선택하세요</p>
                {bulkUploadMode && (
                  <div className="mt-4 p-3 bg-white bg-opacity-20 rounded-lg">
                    <p className="text-sm font-medium">일괄 업로드 모드 활성화</p>
                    <p className="text-xs opacity-80">여러 파일을 동시에 선택할 수 있습니다</p>
                  </div>
                )}
              </div>
              <Input
                id="file-upload"
                type="file"
                multiple={bulkUploadMode}
                {...(bulkUploadMode ? { webkitdirectory: "" } : {})}
                className="hidden"
                onChange={handleFileSelect}
                disabled={isUploading}
              />
              <button
                onClick={() => document.getElementById("file-upload")?.click()}
                className="pill-button text-lg px-8 py-3"
                disabled={isUploading}
              >
                {isUploading ? (
                  <div className="flex items-center gap-3">
                    <div className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                    업로드 중...
                  </div>
                ) : (
                  <div className="flex items-center gap-3">
                    <Upload className="h-5 w-5" />
                    파일/폴더 선택하기
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>

        {uploadedFiles.length > 0 && (
          <div className="max-w-4xl mx-auto">
            <h3 className="text-xl font-bold text-foreground mb-6 text-center">
              업로드된 파일 ({uploadedFiles.length})
            </h3>
            <div className="space-y-4">
              {Array.isArray(uploadedFiles) &&
                uploadedFiles.slice(0, 5).map((file, index) => {
                  const timeRemaining = getTimeUntilExpiry(file.expiresAt)
                  const isExpiringSoon = timeRemaining < 60000

                  return (
                    <div key={index} className="file-item">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-4 flex-1 min-w-0">
                          <div className="p-3 bg-primary text-white rounded-xl">
                            <FileText className="h-5 w-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="font-medium text-foreground truncate" title={file.originalName}>
                              {file.originalName}
                            </p>
                            <div className="flex items-center gap-4 text-sm text-muted-foreground">
                              <span>{formatFileSize(file.size)}</span>
                              <div className={`flex items-center gap-1 ${isExpiringSoon ? "text-destructive" : ""}`}>
                                <Clock className="h-3 w-3" />
                                {formatExpiryTime(timeRemaining)}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => copyShareLink(file.id, file.originalName)}
                            className="pill-button-outline"
                          >
                            {copiedFileId === file.id ? (
                              <>
                                <Check className="h-4 w-4 text-green-500" />
                                복사됨
                              </>
                            ) : (
                              <>
                                <Copy className="h-4 w-4" />
                                공유
                              </>
                            )}
                          </button>
                          <button
                            onClick={() => downloadFile(file)}
                            className="pill-button-outline inline-flex items-center gap-2"
                          >
                            <Download className="h-4 w-4" />
                            다운로드
                          </button>
                          <button
                            onClick={() => deleteFile(file.id, file.originalName)}
                            className="pill-button-outline text-destructive hover:bg-red-50"
                          >
                            <Trash2 className="h-4 w-4" />
                            삭제
                          </button>
                        </div>
                      </div>
                    </div>
                  )
                })}
            </div>
          </div>
        )}
      </div>

      <footer className="mt-20 border-t border-border bg-gradient-to-r from-white to-blue-50/20">
        <div className="container mx-auto px-4 py-12">
          <div className="max-w-4xl mx-auto">
            <div className="text-center mb-8">
              <h3 className="text-xl font-bold text-foreground mb-4">파일 공유가 이렇게 간단할 줄이야!</h3>
              <p className="text-muted-foreground">누구나 쉽게 사용할 수 있는 파일 공유 플랫폼</p>
            </div>

            <div className="grid md:grid-cols-3 gap-6 mb-8">
              <div className="text-center p-6 bg-white rounded-2xl shadow-sm border border-blue-100">
                <div className="w-12 h-12 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Upload className="h-6 w-6 text-blue-600" />
                </div>
                <h4 className="font-semibold text-foreground mb-2">간편한 업로드</h4>
                <p className="text-sm text-muted-foreground">드래그 앤 드롭으로 쉽게 파일을 업로드하세요</p>
              </div>

              <div className="text-center p-6 bg-white rounded-2xl shadow-sm border border-blue-100">
                <div className="w-12 h-12 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Shield className="h-6 w-6 text-green-600" />
                </div>
                <h4 className="font-semibold text-foreground mb-2">안전한 공유</h4>
                <p className="text-sm text-muted-foreground">자동 삭제로 개인정보를 안전하게 보호합니다</p>
              </div>

              <div className="text-center p-6 bg-white rounded-2xl shadow-sm border border-blue-100">
                <div className="w-12 h-12 bg-purple-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <Zap className="h-6 w-6 text-purple-600" />
                </div>
                <h4 className="font-semibold text-foreground mb-2">빠른 처리</h4>
                <p className="text-sm text-muted-foreground">즉시 공유 링크를 생성하고 다운로드할 수 있습니다</p>
              </div>
            </div>

            <div className="text-center text-sm text-muted-foreground">
              <p>© 2025 Dyhs File. 모든 사용자가 안전하고 편리하게 파일을 공유할 수 있도록 지원합니다.</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
