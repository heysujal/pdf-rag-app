'use client'
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input"
import { useRef, useState } from "react";
import {useUser} from '@clerk/nextjs'

export const QueryInput: React.FC = () => {

    const {user} = useUser();
    const email = user?.primaryEmailAddress?.emailAddress;
    const inputRef = useRef<HTMLInputElement>(null); // TODO: add ref for input
    const [messages, setMessages] = useState<{ role: string; content: string }[]>([
        {
            role: 'assistant', content: 'Hello! Ask me anything about your PDF.',
        },
    ]);
    const handleSubmit = async  () => {
        if(!inputRef.current) return;
        const query = inputRef.current?.value;
        if (!query) return;
        messages.push({ role: 'user', content: query });
        setMessages([...messages]);
        inputRef.current.value = '';

        try {
            const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/ask?email=${email}&query=` + query);
            const data = await response.json();
            console.log("Response from server:", data);
            messages.push({ role: 'assistant', content: data.message });
            setMessages([...messages]);
           
        } catch (error) {
            console.error("Error fetching response:", error);
            messages.push({ role: 'assistant', content: 'Sorry, there was an error processing your request.' });
            setMessages([...messages]);
        }
    };
    return (
        <div className="h-full">

            <div id="chat-window" className="h-[80vh] overflow-y-auto p-4 border-b">
                {/* Chat messages will go here */}
                {
                    messages.map((msg, index) => (
                        <div key={index} className={`mb-2 ${msg.role === 'user' ? 'text-right' : 'text-left'}`}>
                            <span className={`inline-block p-2 rounded ${msg.role === 'user' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-black'}`}>
                                {msg.content}
                            </span>
                        </div>
                    ))
                }
            </div>

            <form className="absolute bottom-0" onSubmit={(e) => {
                e.preventDefault();
                handleSubmit();
            }}>
                <Input ref={inputRef} defaultValue={'what is my phone number?'} placeholder="Ask questions about your PDF..." className="w-full rounded-none border-0 focus:ring-0 focus:ring-offset-0" />
                <Button type="submit" className="rounded-none">Send</Button>
            </form>
        </div>
    );
}