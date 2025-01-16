export interface AppError extends Error {
    stack?: string;
    message: string;
} 