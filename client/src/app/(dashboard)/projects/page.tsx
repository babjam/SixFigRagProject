"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@clerk/nextjs";
import { useRouter } from "next/navigation";
import { ProjectsGrid } from "@/components/projects/ProjectsGrid";
import { CreateProjectModal } from "@/components/projects/CreateProjectModal";
import { LoadingSpinner } from "@/components/ui/LoadingSpinner";
import toast from "react-hot-toast";
import { apiClient } from "@/lib/api";

// --- DATA TYPES (The Blueprint) ---
// This matches the shape of the data your Python Backend sends back.
interface Project {
  id: string;
  name: string;
  description: string;
  created_at: string;
  clerk_id: string;
}

function ProjectsPage() {
  // --- STATE (The Short-Term Memory) ---
  
  // "The Menu": Holds the list of projects fetched from the kitchen.
  const [projects, setProjects] = useState<Project[]>([]);
  
  // "The Spinner": Shows while the waiter is walking to the kitchen.
  const [loading, setLoading] = useState(true);
  
  // "The Complaint Box": Holds any errors if the kitchen messes up.
  const [error, setError] = useState(null);

  // --- UI STATE (Visuals) ---
  const [searchQuery, setSearchQuery] = useState("");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");

  // --- MODAL STATE (Popups) ---
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [isCreating, setIsCreating] = useState(false);

  // --- HOOKS (Tools) ---
  // getToken: The VIP Pass needed to talk to the Backend.
  const { getToken, userId } = useAuth();
  const router = useRouter();

  /*
   --- BUSINESS LOGIC (The Actions) ---
  */

  // ACTION 1: LOAD PROJECTS (Ask the Kitchen what's available)
  const loadProjects = async () => {
    try {
      setLoading(true);

      const token = await getToken();

      // [CONNECTION] GET /api/projects
      // This calls the Python function that queries Supabase.
      const result = await apiClient.get("/api/projects", token);

      const { data } = result || {};

      setProjects(data);
    } catch (err) {
      console.error("Error Loading Projects", err);
      // NOTE: Small copy-paste typo here in your original code
      // It says "Failed to create" but should be "Failed to load"
      toast.error("Failed to create project"); 
    } finally {
      setLoading(false);
    }
  };

  // ACTION 2: CREATE PROJECT (Send a new order to the Kitchen)
  const handleCreateProject = async (name: string, description: string) => {
    try {
      setError(null);
      setIsCreating(true);

      const token = await getToken();

      // [CONNECTION] POST /api/projects
      // Sends the name/desc to Python -> Python saves to Supabase -> Returns the new ID
      const result = await apiClient.post(
        "/api/projects",
        {
          name,
          description,
        },
        token
      );

      const savedProject = result?.data || {};
      
      // OPTIMISTIC UPDATE:
      // We add the new project to the list immediately so the user sees it instantly.
      setProjects((prev) => [savedProject, ...prev]);

      setShowCreateModal(false);
      toast.success("Project created successfully!");
    } catch (err) {
      toast.error("Failed to create project");
      console.error("Failed to create project", err);
    } finally {
      setIsCreating(false);
    }
  };

  // ACTION 3: DELETE PROJECT (Cancel an order)
  const handleDeleteProject = async (projectId: string) => {
    try {
      setError(null);
      const token = await getToken();

      // [CONNECTION] DELETE /api/projects/{id}
      await apiClient.delete(`/api/projects/${projectId}`, token);

      // Clean up the local list so the item disappears from the screen
      setProjects((prev) => prev.filter((project) => project.id !== projectId));

      toast.success("Project deleted successfully!");
    } catch (err) {
      toast.error("Failed to delete project");
      console.error("Failed to delete project", err);
    }
  };

  /*
   --- USER INTERACTION (Clicks & Navigation) ---
  */

  // When a user clicks a project card, we drive them to the "Project Details" page.
  // This is where the file uploading (RAG ingredients) will happen.
  const handleProjectClick = (projectId: string) => {
    router.push(`/projects/${projectId}`);
  };

  const handleOpenModal = () => {
    setShowCreateModal(true);
  };

  const handleCloseModal = () => {
    setShowCreateModal(false);
  };

  // EFFECT: Run this once when the user logs in.
  useEffect(() => {
    if (userId) {
      loadProjects();
    }
  }, [userId]);

  // FILTER: Client-side search (Fast!)
  // We filter the list in the browser instead of asking the database every time.
  const filteredProjects = projects.filter(
    (project) =>
      project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      project.description.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return <LoadingSpinner message="Loading projects..." />;
  }

  return (
    <div>
      <ProjectsGrid
        projects={filteredProjects}
        loading={loading}
        error={error}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        onProjectClick={handleProjectClick}
        onCreateProject={handleOpenModal}
        onDeleteProject={handleDeleteProject}
      />

      <CreateProjectModal
        isOpen={showCreateModal}
        onClose={handleCloseModal}
        onCreateProject={handleCreateProject}
        isLoading={isCreating}
      />
    </div>
  );
}

export default ProjectsPage;