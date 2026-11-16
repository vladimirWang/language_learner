mod agent;
mod quiz;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            agent::grade_dialogue_answer,
            quiz::generate_quiz
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
