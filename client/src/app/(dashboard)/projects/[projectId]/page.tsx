"use client";

import { use, useState, useEffect } from "react";
import { ConversationsList } from "@/components/projects/ConversationsList";
import { KnowledgeBaseSidebar } from "@/components/projects/KnowledgeBaseSidebar";
import { FileDetailsModal } from "@/components/projects/FileDetailsModal";
import { apiClient } from "@/lib/api";
import { useAuth } from "@clerk/nextjs";
import toast from "react-hot-toast";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import { NotFound } from "@/components/ui/NotFound";
import { Project, Chat, ProjectDocument, ProjectSettings } from "@/lib/types";
import { useRouter } from "next/navigation";

interface ProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

// --- THE DASHBOARD BLUEPRINT ---
// This single object holds the entire state of the room.
// Instead of 4 separate useState variables, we group them to keep data in sync.
interface ProjectData {
  project: Project | null;        // The Room Details (Name, Desc)
  chats: Chat[];                  // The Conversation History
  documents: ProjectDocument[];   // The RAG Ingredients (Files/URLs)
  settings: ProjectSettings | null; // The AI Configuration
}

function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = use(params);
  const { getToken, userId } = useAuth();
  const router = useRouter();

  // --- 1. DATA STATE (The Truth) ---
  const [data, setData] = useState<ProjectData>({
    project: null,
    chats: [],
    documents: [],
    settings: null,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  // --- 2. UI STATES (The Visuals) ---
  const [activeTab, setActiveTab] = useState<"documents" | "settings">("documents");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);

  // --- 3. THE "MORNING BRIEFING" (Load All Data) ---
  // When you enter the room, we fetch EVERYTHING at once.
  // This uses Promise.all for speed - the browser fires 4 requests simultaneously.
  useEffect(() => {
    const loadAllData = async () => {
      if (!userId) return;

      try {
        setLoading(true);
        setError(null);

        const token = await getToken();

        // [CONNECTION] These 4 calls hit your FastAPI Backend
        const [projectRes, chatsRes, documentsRes, settingsRes] =
          await Promise.all([
            apiClient.get(`/api/projects/${projectId}`, token),
            apiClient.get(`/api/projects/${projectId}/chats`, token),
            apiClient.get(`/api/projects/${projectId}/files`, token),    // <--- Calls "get_project_files"
            apiClient.get(`/api/projects/${projectId}/settings`, token),
          ]);

        setData({
          project: projectRes.data,
          chats: chatsRes.data,
          documents: documentsRes.data,
          settings: settingsRes.data,
        });
      } catch (err) {
        console.error("Fetch error", err);
        // setError("Failed to fetch data"); // Kept commented out for dev smoothness
      } finally {
        setLoading(false);
      }
    };

    loadAllData();
  }, [userId, projectId, getToken]);

/*
 * Short Polling
 */
useEffect(() => {
  // 1. Check if we actually need to poll
  const hasProcessingDocuments = data.documents.some(
    (doc) =>
      doc.processing_status &&
      !["completed", "failed"].includes(doc.processing_status)
  );

  // 2. Stop immediately if nothing is processing
  if (!hasProcessingDocuments) {
    return;
  }

  // 3. Define the polling logic
  const pollInterval = setInterval(async () => {
    try {
      const token = await getToken();
      
      const documentsRes = await apiClient.get(
        `/api/projects/${projectId}/files`,
        token
      );
      
      // ✅ SAFETY CHECK: Ensure component is still on screen before updating state
      setData((prev) => ({
        ...prev,
        documents: documentsRes.data,
      }));
      
    } catch (err) {
      console.error("Polling error:", err);
    }
  }, 2000); // 2 seconds

  // 4. Cleanup
  return () => clearInterval(pollInterval);
}, [data.documents, projectId, getToken]);

  // --- 4. CHAT HANDLERS (Left Panel Logic) ---

  const handleCreateNewChat = async () => {
    if (!userId) return;

    try {
      setIsCreatingChat(true);
      const token = await getToken();
      const chatNumber = Date.now() % 10000;
      
      // [CONNECTION] POST /api/chats
      const result = await apiClient.post(
        "/api/chats",
        {
          title: `Chat #${chatNumber}`,
          project_id: projectId,
        },
        token
      );
      const savedChat = result.data;
      
      // Redirect to the new chat immediately
      router.push(`/projects/${projectId}/chats/${savedChat.id}`);

      setData((prev) => ({
        ...prev,
        chats: [savedChat, ...prev.chats],
      }));

      toast.success("Chat Created successfully");
    } catch (err: unknown) {
      console.error("Failed to create chat", err);
      toast.error("Failed to create chat");
    } finally {
      setIsCreatingChat(false);
    }
  };

  const handleDeleteChat = async (chatId: string) => {
    if (!userId) return;
    try {
      const token = await getToken();
      await apiClient.delete(`/api/chats/${chatId}`, token);
      
      setData((prev) => ({
        ...prev,
        chats: prev.chats.filter((chat) => chat.id !== chatId),
      }));
      toast.success("Chat deleted successfully");
    } catch (err: unknown) {
      toast.error("Failed to delete chat");
    }
  };

  const handleChatClick = (chatId: string) => {
    router.push(`/projects/${projectId}/chats/${chatId}`);
  };

  // --- 5. DOCUMENT HANDLERS (Right Panel Logic) ---
  // This is the section we spent the most time debugging!

  const handleDocumentUpload = async (files: File[]) => {
    if (!userId) return;
    const token = await getToken();
    const uploadedDocuments: ProjectDocument[] = [];

    // Parallel Processing: Upload multiple files at the same time
    const uploadedPromises = files.map(async (file) => {
      try {
        console.log("Uploading file", file.name);
        
        // STEP A: Get the Ticket (Presigned URL)
        // [CONNECTION] POST /api/projects/{id}/files/upload-url
        const uploadData = await apiClient.post(
          `/api/projects/${projectId}/files/upload-url`,
          {
            filename: file.name,
            file_type: file.type,
            file_size: file.size,
          },
          token
        );
        
        // *CRITICAL FIX WE MADE*: Extract "s3_key" correctly
        const { upload_url, s3_key } = uploadData.data;

        // STEP B: Drop off the file at the Loading Dock (Tigris/S3)
        // This goes directly to AWS/Tigris, skipping our Python server
        await apiClient.uploadToS3(upload_url, file);

        // STEP C: Confirm Receipt
        // [CONNECTION] POST /api/projects/{id}/files/confirm-upload
        // This tells Python: "The file is there, mark it as 'queued'!"
        const updatedDocument = await apiClient.post(
          `/api/projects/${projectId}/files/confirm-upload`,
          { s3_key },
          token
        );
        
        uploadedDocuments.push(updatedDocument.data);
      } catch (err) {
        console.error("Failed to get upload URL for file", file.name, err);
        toast.error(`Failed to get upload URL for file ${file.name}`);
        return null;
      }
    });

    await Promise.allSettled(uploadedPromises);

    // Update UI immediately
    if (uploadedDocuments.length > 0) {
      setData((prev) => ({
        ...prev,
        documents: [...uploadedDocuments, ...prev.documents],
      }));
      toast.success(
        `Uploaded ${uploadedDocuments.length} / ${files.length} files successfully`
      );
    }
  };

  const handleDocumentDelete = async (documentId: string) => {
    if (!userId) return;
    try {
      const token = await getToken();
      // [CONNECTION] DELETE /api/projects/{id}/files/{docId}
      await apiClient.delete(
        `/api/projects/${projectId}/files/${documentId}`,
        token
      );
      toast.success("Document deleted successfully");
      
      setData((prev) => ({
        ...prev,
        documents: prev.documents.filter((doc) => doc.id !== documentId),
      }));
    } catch (err) {
      console.error("Failed to delete document", err);
      toast.error("Failed to delete document");
    }
  };

  // --- 6. URL HANDLER (Remote Ingredients) ---
  const handleUrlAdd = async (url: string) => {
    if (!userId) return;
    try {
      const token = await getToken();
      
      // [CONNECTION] POST /api/projects/{id}/urls
      // We fixed this route to accept { url: string } and create a valid DB entry
      const result = await apiClient.post(
        `/api/projects/${projectId}/urls`,
        { url },
        token
      );
      
      const newDocument = result.data;
      
      // OPTIMISTIC UPDATE: Show the new URL immediately
      setData((prev) => ({
        ...prev,
        documents: [newDocument, ...prev.documents],
      }));
      
      toast.success("URL added successfully");
    } catch (err) {
      console.error("Failed to add URL", err);
      toast.error("Failed to add URL");
    }
  };

  const handleOpenDocument = (documentId: string) => {
    setSelectedDocumentId(documentId);
  };

  // --- 7. SETTINGS HANDLERS (The Brain Configuration) ---

  const handleDraftSettings = (updates: any) => {
    // This only updates the local state (Frontend), not the Database yet.
    // It lets the user type without freezing the screen on every keystroke.
    setData((prev) => {
      if (!prev.settings) return prev;
      return {
        ...prev,
        settings: {
          ...prev.settings,
          ...updates,
        },
      };
    });
  };

  const handlePublishSettings = async () => {
    if (!userId || !data.settings) {
        toast.error("Cannot publish settings: User not authenticated or settings not loaded");
    }
    try {
        const token = await getToken();
        // [CONNECTION] PUT /api/projects/{id}/settings
        // Saves the System Prompt and Temperature to the DB.
        const result = await apiClient.put(
            `/api/projects/${projectId}/settings`,
            data.settings,
            token
        );
        setData((prev) => ({
            ...prev,
            settings: result.data,
        }));
        toast.success("Settings updated successfully!");
        
    } catch (err) {
        toast.error("Failed to update settings");
    }
  };

  // --- 8. RENDER (The Layout) ---
  if (loading) {
    return <LoadingSpinner message="Loading project..." />;
  }

  if (!data.project) {
    return <NotFound message="Project not found" />;
  }

  // Helper to find the full document object when opening the modal
  const selectedDocumentReal = selectedDocumentId
    ? data.documents.find((doc) => doc.id == selectedDocumentId)
    : null;

  return (
    <>
      <div className="flex h-screen bg-[#0d1117] gap-4 p-4">
        {/* LEFT PANEL: Chat History */}
        <ConversationsList
          project={data.project}
          conversations={data.chats}
          error={error}
          loading={loading}
          onCreateNewChat={handleCreateNewChat}
          onChatClick={handleChatClick}
          onDeleteChat={handleDeleteChat}
        />

        {/* RIGHT PANEL: RAG Control Center */}
        <KnowledgeBaseSidebar
          activeTab={activeTab}
          onSetActiveTab={setActiveTab}
          projectDocuments={data.documents}
          // Passing our connected handlers down to the UI components
          onDocumentUpload={handleDocumentUpload}
          onDocumentDelete={handleDocumentDelete}
          onOpenDocument={handleOpenDocument}
          onUrlAdd={handleUrlAdd}
          projectSettings={data.settings}
          settingsError={null}
          settingsLoading={false}
          onUpdateSettings={handleDraftSettings}
          onApplySettings={handlePublishSettings}
        />
      </div>

      {/* OVERLAY: Document Details */}
      {selectedDocumentReal && (
        <FileDetailsModal
          document={selectedDocumentReal}
          onClose={() => setSelectedDocumentId(null)}
        />
      )}
    </>
  );
}

export default ProjectPage;