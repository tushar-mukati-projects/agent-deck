const BADGE_SIZE: u32 = 32;
const BADGE_RING_WIDTH: f32 = 3.0;
const BADGE_RING_RGB: [u8; 3] = [18, 19, 23];
const BADGE_FILL_RGB: [u8; 3] = [226, 122, 85];

pub fn icon() -> tauri::image::Image<'static> {
    let center = (BADGE_SIZE as f32 - 1.0) / 2.0;
    let rgba = (0..BADGE_SIZE * BADGE_SIZE)
        .flat_map(|i| {
            let (x, y) = ((i % BADGE_SIZE) as f32, (i / BADGE_SIZE) as f32);
            let distance = ((x - center).powi(2) + (y - center).powi(2)).sqrt();
            let alpha = ((center - distance + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
            let [r, g, b] = if distance > center - BADGE_RING_WIDTH { BADGE_RING_RGB } else { BADGE_FILL_RGB };
            [r, g, b, alpha]
        })
        .collect();
    tauri::image::Image::new_owned(rgba, BADGE_SIZE, BADGE_SIZE)
}
