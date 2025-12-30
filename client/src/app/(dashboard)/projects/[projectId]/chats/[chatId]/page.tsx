/*
export default function ChatPage() {
  return <div>ChatPage</div>;
}
*/
"use client";

import { ChatInterface } from "@/components/chat/ChatInterface";
import { use } from "react";

interface ChatPageProps {
  params: Promise<{
    projectId: string;
    chatId: string;
  }>;
}

export default function ChatPage({ params }: ChatPageProps) {
  // On déballe les paramètres (Next.js 15)
  const { chatId, projectId } = use(params);

  return (
    <div className="h-full bg-gray-900 text-white">
      <ChatInterface chat={chatId} project={projectId} />
    </div>
  );
}