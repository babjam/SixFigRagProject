"use client";

import { use, useState } from "react";
import { ConversationsList } from "@/components/projects/ConversationsList";
import { KnowledgeBaseSidebar } from "@/components/projects/KnowledgeBaseSidebar";
import { FileDetailsModal } from "@/components/projects/FileDetailsModal";
import { useEffect } from "react";
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

interface ProjectData {
  project: Project | null;
  chats: Chat[];
  documents: ProjectDocument[];
  settings: ProjectSettings | null;
}

function ProjectPage({ params }: ProjectPageProps) {
  const { projectId } = use(params);
  const { getToken, userId } = useAuth();
  const router = useRouter();

  // Data State
  const [data, setData] = useState<ProjectData>({
    project: null,
    chats: [],
    documents: [],
    settings: null,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  // UI states

  const [activeTab, setActiveTab] = useState<"documents" | "settings">(
    "documents"
  );

  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );
  // Mock data for static UI
  //Mock data for static UI
  const mockProject = {
    id: projectId,
    name: "Research Analysis Project",
    description: "AI and machine learning research papers",
    created_at: new Date().toISOString(),
    clerk_id: "user_123",
  };

  const mockChats = [
    {
      id: "chat_1",
      project_id: projectId,
      title: "Chat #1234",
      created_at: new Date(Date.now() - 86400000).toISOString(),
      clerk_id: "user_123",
    },
    {
      id: "chat_2",
      project_id: projectId,
      title: "Chat #5678",
      created_at: new Date(Date.now() - 172800000).toISOString(),
      clerk_id: "user_123",
    },
  ];

  const mockDocuments = [
    {
      id: "doc_1",
      project_id: projectId,
      filename: "research_paper.pdf",
      s3_key: "projects/123/documents/research_paper.pdf",
      file_size: 2457600,
      file_type: "application/pdf",
      processing_status: "completed",
      clerk_id: "user_123",
      created_at: new Date(Date.now() - 3600000).toISOString(),
      source_type: "file",
      processing_details: {},
    },
  ];

  const mockSettings = {
    id: "settings_1",
    project_id: projectId,
    embedding_model: "text-embedding-3-large",
    rag_strategy: "basic",
    agent_type: "agentic",
    chunks_per_search: 10,
    final_context_size: 5,
    similarity_threshold: 0.3,
    number_of_queries: 5,
    reranking_enabled: true,
    reranking_model: "rerank-english-v3.0",
    vector_weight: 0.7,
    keyword_weight: 0.3,
    created_at: new Date().toISOString(),
  };
  // enD of mock data
  /*
    ! Business Logic Functions - Core operations for this project:
    * - loadProjectData: Load all project data from the server
  */
  useEffect(() => {
    const loadAllData = async () => {
      if (!userId) return;

      try {
        setLoading(true);
        setError(null);

        const token = await getToken();

        const [projectRes, chatsRes, documentsRes, settingsRes] =
          await Promise.all([
            apiClient.get(`/api/projects/${projectId}`, token),
            apiClient.get(`/api/projects/${projectId}/chats`, token),
            apiClient.get(`/api/projects/${projectId}/files`, token),
            apiClient.get(`/api/projects/${projectId}/settings`, token),
          ]);

        setData({
          project: projectRes.data,
          chats: chatsRes.data,
          documents: documentsRes.data,
          settings: settingsRes.data,
        });
      } catch (err) {
        setError("Failed to fetch data");
        toast.error("Failed to fetch data");
      } finally {
        setLoading(false);
      }
    };

    loadAllData();
  }, [userId, projectId]);

  /*
  ! User Interation functions

  * - handleCreateNewChat: Create a new conversation in this project
  * - handleDeleteChat: Remove a conversation from the project
  * - handleChatClick: Navigate to a specific chat
  * - handleDocumentUpload: Process and add new documents to knowledge base
  * - handleDocumentDelete: Remove documents from knowledge base
  * - handleUrlAdd: Add web content to the knowledge base
  * - handleOpenDocument: Open a specific document
  * - handleDraftSettings: Update project configuration locally
  * - handlePublishSettings: Save project settings to the server
  */

  const handleCreateNewChat = async () => {
    if (!userId) return;

    try {
      setIsCreatingChat(true);
      const token = await getToken();
      const chatNumber = Date.now() % 10000;
      const result = await apiClient.post(
        "/api/chats",
        {
          title: `Chat #${chatNumber}`,
          project_id: projectId,
        },
        token
      );
      const savedChat = result.data;
      router.push(`/projects/${projectId}/chats/${savedChat.id}`);

      // Update local state
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

      // Update local state
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
    // handle documents functions
  const handleDocumentUpload = async (files: File[]) => {
    console.log("Upload files", files);
  };

  const handleDocumentDelete = async (documentId: string) => {
    console.log("Document Deleted");
  };

  const handleUrlAdd = async (url: string) => {
    console.log("Add URL", url);
  };

  const handleOpenDocument = (documentId: string) => {
    console.log("Open document", documentId);
    setSelectedDocumentId(documentId);
  };
  // handle settings functions
  const handleDraftSettings = (updates: unknown) => {
    console.log("Update local state with draft settings", updates);
  };

  const handlePublishSettings = async () => {
    console.log("Make API call to publish settings");
  };
 
  
  const selectedDocument = selectedDocumentId
    ? mockDocuments.find((doc) => doc.id == selectedDocumentId)
    : null;
  return(
    <>
   <div>
    <div className="flex h-screen bg-[#0d1117] gap-4 p-4">
    <ConversationsList
      project={mockProject}
      conversations={mockChats}
      error={null}
      loading={false}
      onCreateNewChat={handleCreateNewChat}
      onChatClick={handleChatClick}
      onDeleteChat={handleDeleteChat}
    />

    {/* KnowledgeBase Sidebar */}
   <KnowledgeBaseSidebar
    activeTab={activeTab}
    onSetActiveTab={setActiveTab}
    projectDocuments={mockDocuments}
    onDocumentUpload={handleDocumentUpload}
    onDocumentDelete={handleDocumentDelete}
    onOpenDocument={handleOpenDocument}
    onUrlAdd={handleUrlAdd}
    projectSettings={mockSettings}
    settingsError={null}
    settingsLoading={false}
    onUpdateSettings={handleDraftSettings}
    onApplySettings={handlePublishSettings}
    />
   </div>
  </div>
  {selectedDocument && (
    <FileDetailsModal
      document={selectedDocument}
      onClose={() => setSelectedDocumentId(null)}
    />
  )}
  </>
 );





  if (loading) {
    return <LoadingSpinner message="Loading project..." />;
  }

  if (!data.project) {
    return <NotFound message="Project not found" />;
  }

{ /* const selectedDocument = selectedDocumentId
    ? data.documents.find((doc) => doc.id == selectedDocumentId)
    : null;*/}

  return (
    <>
      <div className="flex h-screen bg-[#0d1117] gap-4 p-4">
        <ConversationsList
          project={mockProject}
          conversations={mockChats}
          error={null}
          loading={false}
          onCreateNewChat={handleCreateNewChat}
          onChatClick={handleChatClick}
          onDeleteChat={handleDeleteChat}
        />

        {/* KnowledgeBase Sidebar */}
        <KnowledgeBaseSidebar
          activeTab={activeTab}
          onSetActiveTab={setActiveTab}
          projectDocuments={data.documents}
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
      {selectedDocument && (
        <FileDetailsModal
          document={selectedDocument}
          onClose={() => setSelectedDocumentId(null)}
        />
      )}
    </>
  );
}

export default ProjectPage;
