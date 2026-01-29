async function updateStock({ listing, targetQty }) {
  console.log("[ELEVENST][stub] updateStock", {
    listingId: listing?.id,
    channelProductId: listing?.channelProductId,
    channelOptionId: listing?.channelOptionId,
    targetQty,
  });
  return { ok: true };
}

export { updateStock };
