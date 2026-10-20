const SIZE_PX: u32 = 32;
const RING_WIDTH_PX: f32 = 3.0;
const RING_RGB: [u8; 3] = [18, 19, 23];
const FILL_RGB: [u8; 3] = [226, 122, 85];

pub fn icon() -> tauri::image::Image<'static> {
    let center = (SIZE_PX as f32 - 1.0) / 2.0;
    let rgba = (0..SIZE_PX * SIZE_PX)
        .flat_map(|i| {
            let (x, y) = ((i % SIZE_PX) as f32, (i / SIZE_PX) as f32);
            let distance = ((x - center).powi(2) + (y - center).powi(2)).sqrt();
            let alpha = ((center - distance + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
            let [r, g, b] = if distance > center - RING_WIDTH_PX { RING_RGB } else { FILL_RGB };
            [r, g, b, alpha]
        })
        .collect();
    tauri::image::Image::new_owned(rgba, SIZE_PX, SIZE_PX)
}
