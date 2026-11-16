mod agent;
mod materials;
mod quiz;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            agent::grade_dialogue_answer,
            quiz::generate_quiz,
            materials::check_material_update,
            materials::apply_material_update
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
