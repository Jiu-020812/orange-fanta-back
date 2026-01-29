async function updateStock({ listing, targetQty }) {
  console.log("[NAVER][stub] updateStock", {
    listingId: listing?.id,
    channelProductId: listing?.channelProductId,
    channelOptionId: listing?.channelOptionId,
    targetQty,
  });
  return { ok: true };
}

export { updateStock };
