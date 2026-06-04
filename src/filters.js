/*    Unified CSS filter pipeline for video element.
      Controls: brightness, contrast, saturate, hue-rotate, blur.
      Called by: setFilter(), resetVideoFilters(), adjustBrightness(),
      setRotate(), toggleFlip(), setScale(), applySceneStyle(). */

/** Update favorite button states */
function renderFavBtns() {
  const item = playlist.find(function(v) { return v.id === currentVideoId; });
  const isFav = item ? item.favorite : false;
  DOM.favBtn.classList.toggle('faved', isFav);
  DOM.favBtn2.classList.toggle('active', isFav);
}
