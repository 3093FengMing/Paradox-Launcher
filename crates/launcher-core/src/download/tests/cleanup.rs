use super::*;
struct FlushFailure(Arc<AtomicUsize>);
impl tokio::io::AsyncWrite for FlushFailure {
    fn poll_write(
        self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
        bytes: &[u8],
    ) -> std::task::Poll<std::io::Result<usize>> {
        std::task::Poll::Ready(Ok(bytes.len()))
    }
    fn poll_flush(
        self: std::pin::Pin<&mut Self>,
        _: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        std::task::Poll::Ready(Err(std::io::Error::other("injected flush failure")))
    }
    fn poll_shutdown(
        self: std::pin::Pin<&mut Self>,
        context: &mut std::task::Context<'_>,
    ) -> std::task::Poll<std::io::Result<()>> {
        self.poll_flush(context)
    }
}
impl Drop for FlushFailure {
    fn drop(&mut self) {
        self.0.fetch_add(1, Ordering::SeqCst);
    }
}

#[tokio::test]
async fn flush_failure_overrides_cancellation_and_retains_an_execution_failure() {
    for initial in [
        Err(DownloadError::Cancelled),
        Err(DownloadError::Failed("earlier transfer failed".into())),
        Ok(3),
    ] {
        let retain_execution = matches!(initial, Err(DownloadError::Failed(_)));
        let drops = Arc::new(AtomicUsize::new(0));
        let result = finish_transfer_output(FlushFailure(drops.clone()), initial).await;
        assert_eq!(
            drops.load(Ordering::SeqCst),
            1,
            "the writer must close before returning its result"
        );
        let Err(DownloadError::Failed(message)) = result else {
            panic!("flush failure was hidden: {result:?}");
        };
        assert!(message.contains("injected flush failure"));
        assert_eq!(
            message.contains("earlier transfer failed"),
            retain_execution
        );
    }
}

#[test]
fn staging_cleanup_failure_overrides_cancellation_and_retains_execution_error() {
    for initial in [
        DownloadError::Cancelled,
        DownloadError::Failed("earlier transfer failed".into()),
    ] {
        let retain_execution = matches!(initial, DownloadError::Failed(_));
        let temporary = tempfile::tempdir().unwrap();
        let path = tempfile::NamedTempFile::new_in(temporary.path())
            .unwrap()
            .into_temp_path();
        let retained = path.to_path_buf();
        std::fs::remove_file(&retained).unwrap();
        std::fs::create_dir(&retained).unwrap();
        let DownloadError::Failed(message) = discard_temporary(path, initial) else {
            panic!("staging cleanup failure was hidden");
        };
        assert!(message.contains("无法移除下载临时文件"));
        assert_eq!(
            message.contains("earlier transfer failed"),
            retain_execution
        );
        assert!(retained.is_dir());
    }
}
