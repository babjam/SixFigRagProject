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

  // --- 1. DATA STATE (REAL LOGIC) ---
  const [data, setData] = useState<ProjectData>({
    project: null,
    chats: [],
    documents: [],
    settings: null,
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isCreatingChat, setIsCreatingChat] = useState(false);

  // --- 2. UI STATES ---
  const [activeTab, setActiveTab] = useState<"documents" | "settings">(
    "documents"
  );
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(
    null
  );



  // --- 4. REAL BUSINESS LOGIC load all the data ---
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
        console.error("Fetch error", err);
        // On ne met pas d'erreur bloquante ici pour laisser la Mock UI s'afficher
        // setError("Failed to fetch data");
      } finally {
        setLoading(false);
      }
    };

    loadAllData();
  }, [userId, projectId, getToken]);

  // --- 5. HANDLERS ---
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

  // Placeholder handlers (Logique à implémenter plus tard)
  const handleDocumentUpload = async (files: File[]) => {
    console.log("Upload files", files);
  };
  const handleDocumentDelete = async (documentId: string) => {
    console.log("Document Deleted", documentId);
  };
  const handleUrlAdd = async (url: string) => {
    console.log("Add URL", url);
  };
  const handleOpenDocument = (documentId: string) => {
    console.log("Open document", documentId);
    setSelectedDocumentId(documentId);
  };
  const handleDraftSettings = (updates: any) => {
    console.log("Update local state with draft settings", updates);
    setData((prev) => {
      // If no settings yet, we can't update them

      if (!prev.settings) {
        console.warn("No settings to update, not loaded yet")
        return prev;
      }
      // Merge updates into existing settings
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
    //console.log("Make API call to publish settings");
    if (!userId || !data.settings) {
        toast.error("Cannot publish settings: User not authenticated or settings not loaded");
    }
    try {
        const token = await getToken();
        const result = await apiClient.put(
            `/api/projects/${projectId}/settings`,
            data.settings,
            token
        )
        setData((prev) => ({
            ...prev,
            settings: result.data,
        }));
        toast.success("Settings updated successfully!");
        
    } catch (err) {
        toast.error("Failed to update settings");
        //console.error("Failed to update settings", err);
    }

  };
 // --- 6. RENDERING LOGIC ---
  if (loading) {
    return <LoadingSpinner message="Loading project..." />;
  }

  if (!data.project) {
    return <NotFound message="Project not found" />;
  }

  const selectedDocumentReal = selectedDocumentId
    ? data.documents.find((doc) => doc.id == selectedDocumentId)
    : null;

  return (
    <>
      <div className="flex h-screen bg-[#0d1117] gap-4 p-4">
        <ConversationsList
          project={data.project}
          conversations={data.chats}
          error={error}
          loading={loading}
          onCreateNewChat={handleCreateNewChat}
          onChatClick={handleChatClick}
          onDeleteChat={handleDeleteChat}
        />

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