import React, {useRef, useCallback, useEffect} from 'react';
import {Button, Col, Input, Row, Tooltip} from 'antd';
import styled from 'styled-components';
import {useSelector} from 'react-redux';
import {isInPreviewModeSelector, isInClusterModeSelector} from '@redux/selectors';

import {BackgroundColors} from '@styles/Colors';
import {useAppDispatch, useAppSelector} from '@redux/hooks';
import {MonoPaneTitle, MonoPaneTitleCol, PaneContainer} from '@atoms';
import {startPreview, stopPreview, restartPreview} from '@redux/services/preview';
import {updateKubeconfig} from '@redux/reducers/appConfig';
import {BrowseKubeconfigTooltip, ClusterModeTooltip} from '@constants/tooltips';
import {TOOLTIP_DELAY} from '@constants/constants';
import {closeFolderExplorer} from '@redux/reducers/ui';

const StyledDiv = styled.div`
  margin-bottom: 10px;
  margin-top: 10px;
`;

const StyledButton = styled(Button)`
  margin-top: 10px;
`;

const HiddenInput = styled.input`
  display: none;
`;

const TitleRow = styled(Row)`
  width: 100%;
  margin: 0;
  padding: 0;
  background: ${BackgroundColors.darkThemeBackground};
`;

const ClustersContainer = styled.div`
  margin: 16px;
`;

const ClustersPane = () => {
  const dispatch = useAppDispatch();
  const previewResource = useAppSelector(state => state.main.previewResourceId);
  const isInPreviewMode = useSelector(isInPreviewModeSelector);
  const isInClusterMode = useSelector(isInClusterModeSelector);
  const previewLoader = useAppSelector(state => state.main.previewLoader);
  const previewType = useAppSelector(state => state.main.previewType);
  const kubeconfig = useAppSelector(state => state.config.kubeconfigPath);
  const uiState = useAppSelector(state => state.ui);

  const fileInput = useRef<HTMLInputElement>(null);

  const openFileSelect = () => {
    fileInput && fileInput.current?.click();
  };

  const onSelectFile = (e: React.SyntheticEvent) => {
    e.preventDefault();
    if (fileInput.current?.files && fileInput.current.files.length > 0) {
      const file: any = fileInput.current.files[0];
      if (file.path) {
        const path = file.path;
        dispatch(updateKubeconfig(path));
      }
    }
  };

  const connectToCluster = () => {
    if (isInPreviewMode && previewResource !== kubeconfig) {
      stopPreview(dispatch);
    }
    startPreview(kubeconfig, 'cluster', dispatch);
  };

  const reconnectToCluster = () => {
    if (isInPreviewMode && previewResource !== kubeconfig) {
      stopPreview(dispatch);
    }
    restartPreview(kubeconfig, 'cluster', dispatch);
  };

  const createClusterObjectsLabel = useCallback(() => {
    if (isInClusterMode) {
      return <span>Reload Cluster Objects</span>;
    }
    if (previewType === 'cluster' && previewLoader.isLoading) {
      return <span>Loading Cluster Objects</span>;
    }
    return <span>Show Cluster Objects</span>;
  }, [previewType, previewLoader, isInClusterMode]);

  useEffect(() => {
    if (uiState.leftMenu.selection === 'cluster-explorer' && uiState.folderExplorer.isOpen) {
      openFileSelect();
      dispatch(closeFolderExplorer());
    }
  }, [uiState]);

  return (
    <>
      <TitleRow>
        <MonoPaneTitleCol span={24}>
          <Row>
            <Col span={12}>
              <MonoPaneTitle>Clusters</MonoPaneTitle>
            </Col>
          </Row>
        </MonoPaneTitleCol>
      </TitleRow>
      <PaneContainer>
        <ClustersContainer>
          <StyledDiv>KUBECONFIG</StyledDiv>
          <Input value={kubeconfig} />
          <Tooltip mouseEnterDelay={TOOLTIP_DELAY} title={BrowseKubeconfigTooltip} placement="right">
            <StyledButton ghost type="primary" onClick={openFileSelect}>
              Browse
            </StyledButton>
          </Tooltip>
          <HiddenInput type="file" onChange={onSelectFile} ref={fileInput} />
          <StyledDiv>Select to retrieve resources from configured kubeconfig</StyledDiv>

          <Tooltip mouseEnterDelay={TOOLTIP_DELAY} title={ClusterModeTooltip} placement="right">
            <Button
              type="primary"
              ghost
              loading={previewType === 'cluster' && previewLoader.isLoading}
              onClick={isInClusterMode ? reconnectToCluster : connectToCluster}
            >
              {createClusterObjectsLabel()}
            </Button>
          </Tooltip>
        </ClustersContainer>
      </PaneContainer>
    </>
  );
};

export default ClustersPane;
