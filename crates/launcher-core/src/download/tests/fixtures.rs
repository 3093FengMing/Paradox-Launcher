use super::*;
pub(super) fn test_options() -> NetworkOptions {
    NetworkOptions {
        max_concurrent_downloads: 2,
        max_retries: 1,
        timeout_seconds: 3,
        ..NetworkOptions::default()
    }
}

pub(super) fn checksum(bytes: &[u8]) -> Checksum {
    Checksum::Sha256(hex::encode(sha2::Sha256::digest(bytes)))
}

pub(super) async fn serve(
    responses: Vec<Vec<u8>>,
) -> (String, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let count = Arc::new(AtomicUsize::new(0));
    let server_count = count.clone();
    let server = tokio::spawn(async move {
        for response in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut request = [0u8; 4096];
            let _ = stream.read(&mut request).await;
            server_count.fetch_add(1, Ordering::SeqCst);
            let _ = stream.write_all(&response).await;
        }
    });
    (format!("http://{address}/file"), count, server)
}

pub(super) fn response(bytes: &[u8]) -> Vec<u8> {
    let mut response = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        bytes.len()
    )
    .into_bytes();
    response.extend_from_slice(bytes);
    response
}
