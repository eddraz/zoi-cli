import { system } from "../../system";
import { getInfo, setInfo } from "../../info-manager";
import { sayInUserLanguage } from "./user";

export type TimeSlot = "morning" | "afternoon" | "evening" | "night";

export function getTimeSlot(hours: number): TimeSlot {
    if (hours >= 5 && hours < 12) return "morning";
    if (hours >= 12 && hours < 18) return "afternoon";
    if (hours >= 18 && hours < 22) return "evening";
    return "night";
}

export const defaultTemplates: Record<TimeSlot, string> = {
    morning: "Good morning, {username}. Today is {date} and the time is {time}. How can I help you?",
    afternoon: "Good afternoon, {username}. Today is {date} and the time is {time}. How can I help you?",
    evening: "Good evening, {username}. Today is {date} and the time is {time}. How can I help you?",
    night: "Good night, {username}. Today is {date} and the time is {time}. How can I help you?",
};

export async function sayHello() {
    const info = await getInfo();

    const username = info.user?.name?.split(' ').at(0) || system.user.username;
    const now = new Date();
    const locale = (system.language.code || "en-US").replace(/_/g, "-").split(".")[0];
    const date = now.toLocaleDateString(locale, {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
    });
    const timeString = now.toLocaleTimeString(locale, {
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });

    const timeSlot = getTimeSlot(now.getHours());

    if (!info.languages) {
        info.languages = {};
    }
    if (!info.languages[system.language.code]) {
        info.languages[system.language.code] = {
            code: system.language.code,
            name: system.language.name,
        };
    }
    if (!info.languages[system.language.code].dictionary) {
        info.languages[system.language.code].dictionary = {};
    }

    let template = info.languages[system.language.code].dictionary[timeSlot];

    if (!template) {
        if (system.language.name === "English" || system.language.code.startsWith("en")) {
            template = defaultTemplates[timeSlot];
        } else {
            const baseTemplate = defaultTemplates[timeSlot];
            const response = await sayInUserLanguage(baseTemplate);
            template = response?.content || baseTemplate;
        }

        info.languages[system.language.code].dictionary[timeSlot] = template;
        await setInfo(info);
    }

    return template
        .replace(/{(?:username|name|nombre|usuario)}/gi, username)
        .replace(/{(?:date|fecha)}/gi, date)
        .replace(/{(?:time|hora|timeString)}/gi, timeString);
}